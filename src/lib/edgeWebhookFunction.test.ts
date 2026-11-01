import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { edgeRuntime as runtime } from './edgeRuntimeTestUtils'


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
