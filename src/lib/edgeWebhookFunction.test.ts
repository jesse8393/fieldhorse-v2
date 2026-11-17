import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { edgeRuntime as runtime } from './edgeRuntimeTestUtils'
import { fakeClient, newState } from './teamAccountFakeSupabase'


const key = Buffer.from('test-only-signing-secret-never-used-by-a-provider')
const secret = `whsec_${key.toString('base64')}`
const raw = JSON.stringify({ type: 'email.sent', data: {} })
function signedRequest(offset = 0, version = 'v1', body = raw) {
  const timestamp = String(Math.floor(Date.now() / 1000) + offset)
  const signature = createHmac('sha256', key).update(`msg_test.${timestamp}.${raw}`).digest('base64')
  return new Request('https://example.test/functions/v1/email-events', { method: 'POST', body, headers: {
    'content-type': 'application/json', 'svix-id': 'msg_test', 'svix-timestamp': timestamp, 'svix-signature': `${version},${signature}`
  } })
}

describe('provider webhook authentication', () => {
  it.each([undefined, '', 'wrong-token'])('rejects Postmark without the configured token (%s)', async (configured) => {
    const app = runtime(configured === undefined ? {} : { POSTMARK_INBOUND_TOKEN: configured })
    const request = new Request('https://example.test/email-events?provider=postmark&token=submitted-token', { method: 'POST', body: '{}' })
    expect((await app.endpoint('email-events')(request)).status).toBe(403)
    expect(app.createClient).not.toHaveBeenCalled()
  })

  it('accepts the correct Postmark token', async () => {
    const app = runtime({ POSTMARK_INBOUND_TOKEN: 'test-token' })
    const request = new Request('https://example.test/email-events?provider=postmark&token=test-token', { method: 'POST', body: '{}' })
    const result = await app.endpoint('email-events')(request)
    expect(result.status).toBe(200)
    expect(await result.json()).toEqual({ ok: true, ignored: 'no from' })
  })

  it.each(['email-events', 'twilio-sms', 'twilio-voice', 'meta-leads'])('cannot disable %s authentication with a legacy flag', async (name) => {
    const app = runtime({ RESEND_VALIDATE_SIGNATURE: 'false', TWILIO_VALIDATE_SIGNATURE: 'false', META_VALIDATE_SIGNATURE: 'false' })
    const response = await app.endpoint(name)(new Request(`https://example.test/${name}`, { method: 'POST', body: '{}' }))
    expect(response.status).toBe(403)
    expect(app.createClient).not.toHaveBeenCalled()
  })

  it('accepts a fresh signed Resend event and rejects tampering', async () => {
    const app = runtime({ RESEND_WEBHOOK_SECRET: secret })
    expect(await app.shared.svixSignatureOk(signedRequest(), raw, secret)).toBe(true)
    expect((await app.endpoint('email-events')(signedRequest())).status).toBe(200)
    expect(await app.shared.svixSignatureOk(signedRequest(), raw + ' ', secret)).toBe(false)
  })

  it.each([-301, 301, -86_400])('rejects a correctly signed event outside the replay window (%s seconds)', async (offset) => {
    const app = runtime({ RESEND_WEBHOOK_SECRET: secret })
    expect((await app.endpoint('email-events')(signedRequest(offset))).status).toBe(403)
    expect(app.createClient).not.toHaveBeenCalled()
  })

  it('rejects unsupported signature versions, malformed secrets and invalid timestamps', async () => {
    const { shared } = runtime()
    expect(await shared.svixSignatureOk(signedRequest(0, 'v2'), raw, secret)).toBe(false)
    expect(await shared.svixSignatureOk(signedRequest(), raw, 'whsec_%%%')).toBe(false)
    const req = signedRequest()
    req.headers.set('svix-timestamp', 'NaN')
    expect(await shared.svixSignatureOk(req, raw, secret)).toBe(false)
  })

  it('accepts a valid v1 signature among rotated signatures', async () => {
    const { shared } = runtime()
    const req = signedRequest()
    req.headers.set('svix-signature', `v1,invalid ${req.headers.get('svix-signature')}`)
    expect(await shared.svixSignatureOk(req, raw, secret)).toBe(true)
  })
})

// FN-11. An inbound "Yes" was stored as marketing consent, and plain stop
// requests ("Stop texting me", "please stop") were filed as ordinary texts.
describe('inbound text keywords', () => {
  const TOKEN = 'test-only-twilio-token'
  const HOOK = 'https://example.test/functions/v1/twilio-sms'
  const ORG = 'org-texts'

  function inbound(body: string) {
    const params: Record<string, string> = { MessageSid: 'SM-test-1', From: '+15125550101', To: '+15125550199', Body: body, NumMedia: '0' }
    const signed = HOOK + Object.keys(params).sort().map((k) => k + params[k]).join('')
    return new Request(HOOK, { method: 'POST', body: new URLSearchParams(params).toString(), headers: {
      'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': createHmac('sha1', TOKEN).update(signed).digest('base64')
    } })
  }

  async function text(body: string) {
    const state = newState({ fh_phone_numbers: [{ id: 'num-1', org_id: ORG, status: 'active', e164: '+15125550199' }], fh_messages: [] })
    state.rpc = {
      fh_resolve_client: () => [{ client_id: 'client-1', is_new: false }],
      fh_conversation_for_client: () => 'conv-1',
      fh_consent_set: () => null,
      fh_automation_tick: () => null,
      fh_org_ctx: () => ({ name: 'Parker Concrete', phone: '+15125550100' }),
    }
    const app = runtime({ TWILIO_AUTH_TOKEN: TOKEN })
    app.createClient.mockImplementation(() => fakeClient(state) as any)
    const response = await app.endpoint('twilio-sms')(inbound(body))
    const consent = state.log.filter((l) => l.op === 'rpc' && l.fn === 'fh_consent_set').map((l) => l.payload.p_status)
    return { response, consent, messages: state.tables.fh_messages }
  }

  it.each([
    'STOP', 'stop', '  Stop  ', 'STOP.', 'Stop!', 'STOPALL', 'stop all', 'UNSUBSCRIBE', ' unsubscribe\n', 'CANCEL', 'cancel',
    'END', ' end ', 'QUIT', 'quit.', 'Stop texting me', 'please stop', 'REVOKE', 'opt out', 'Opt-out', 'Unsubscribe me',
  ])('opts out on %j and still keeps the text', async (body) => {
    const { response, consent, messages } = await text(body)
    expect(response.status).toBe(200)
    expect(consent).toEqual(['opted_out'])
    expect(messages).toHaveLength(1)
  })

  it.each(['Yes', 'yes!', 'YES please', 'Yes, Tuesday works', 'ok'])('does not take %j as consent to marketing texts', async (body) => {
    const { consent, messages } = await text(body)
    expect(consent).toEqual([])
    expect(messages).toHaveLength(1)
  })

  it.each(['START', 'unstop', 'Subscribe'])('opts back in only on the explicit keyword %j', async (body) => {
    expect((await text(body)).consent).toEqual(['opted_in'])
  })

  it.each(['Can you stop by Tuesday?', 'Please stop by after 3', 'Cancel Tuesday, I will call to rebook', 'The end of the driveway is cracked'])(
    'keeps %j as an ordinary text', async (body) => {
      const { consent, messages } = await text(body)
      expect(consent).toEqual([])
      expect(messages).toHaveLength(1)
    })
})

// FN-12. Consent was any field whose name contained text, sms or consent with
// an answer containing yes, true, ok or agree, so "No, I do not agree" and a
// project_context answer both counted as consent to text.
describe('Meta lead form consent', () => {
  const APP_SECRET = 'test-only-meta-app-secret'
  const body = JSON.stringify({ entry: [{ id: 'page-1', changes: [{ field: 'leadgen', value: { leadgen_id: 'lead-1', form_id: 'form-1' } }] }] })

  async function capture(fieldData: Array<{ name: string; values: string[] }>) {
    const state = newState({ fh_channels: [{ id: 'ch-1', org_id: 'org-meta', kind: 'messenger', external_id: 'page-1', status: 'active', config: { page_token: 'test-page-token' } }] })
    state.rpc = { fh_lead_capture: () => ({ ok: true }), fh_automation_tick: () => null }
    const graph = async () => new Response(JSON.stringify({ field_data: [{ name: 'full_name', values: ['Pat Lee'] }, { name: 'phone_number', values: ['+15125550101'] }, ...fieldData] }), { status: 200 })
    const app = runtime({ META_APP_SECRET: APP_SECRET }, { fetch: graph })
    app.createClient.mockImplementation(() => fakeClient(state) as any)
    const signature = 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex')
    const response = await app.endpoint('meta-leads')(new Request('https://example.test/functions/v1/meta-leads', {
      method: 'POST', body, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }
    }))
    expect(response.status).toBe(200)
    const call = state.log.find((l) => l.op === 'rpc' && l.fn === 'fh_lead_capture')
    expect(call).toBeTruthy()
    return call!.payload.p_sms_consent
  }

  it.each([
    [{ name: 'sms_consent', values: ['No, I do not agree'] }],
    [{ name: 'text_consent', values: ['Not ok'] }],
    [{ name: 'sms_consent', values: ['No'] }],
    [{ name: 'project_context', values: ['broken slab, please look soon'] }],
    [{ name: 'project_context', values: ['Yes'] }],
  ])('does not read %j as consent', async (field) => {
    expect(await capture([field])).toBe(false)
  })

  it.each([
    [{ name: 'sms_consent', values: ['Yes'] }],
    [{ name: 'text_consent', values: [' yes. '] }],
    [{ name: 'can_we_text_you?', values: ['Yes, I agree'] }],
    [{ name: 'consent', values: ['I agree'] }],
    [{ name: 'sms_opt_in', values: ['true'] }],
  ])('reads the explicit yes %j as consent', async (field) => {
    expect(await capture([field])).toBe(true)
  })

  it('reads no consent when the form asks nothing about texts', async () => {
    expect(await capture([{ name: 'what_do_you_need', values: ['A new driveway, yes'] }])).toBe(false)
  })
})
