import { describe, expect, it } from 'vitest'
import { parseQuoteChangeRequest } from '../../netlify/functions/public-link-request-changes.js'

describe('parseQuoteChangeRequest', () => {
  it('normalizes a valid customer request', () => {
    expect(parseQuoteChangeRequest({
      token: '  secure-token  ',
      requester_name: '  Taylor Reed  ',
      request_text: '  Please separate the cabinet allowance.  ',
    })).toEqual({
      value: {
        token: 'secure-token',
        requesterName: 'Taylor Reed',
        requestText: 'Please separate the cabinet allowance.',
      },
    })
  })

  it('requires a name and meaningful request text', () => {
    expect(parseQuoteChangeRequest({
      token: 'secure-token',
      requester_name: '',
      request_text: 'Please revise this.',
    })).toEqual({ error: 'missing_requester_name' })

    expect(parseQuoteChangeRequest({
      token: 'secure-token',
      requester_name: 'Taylor Reed',
      request_text: '  x ',
    })).toEqual({ error: 'request_too_short' })
  })

  it('rejects oversized public input', () => {
    expect(parseQuoteChangeRequest({
      token: 'x'.repeat(257),
      requester_name: 'Taylor Reed',
      request_text: 'Please revise this.',
    })).toEqual({ error: 'invalid_token' })

    expect(parseQuoteChangeRequest({
      token: 'secure-token',
      requester_name: 'Taylor Reed',
      request_text: 'x'.repeat(2001),
    })).toEqual({ error: 'request_too_long' })
  })
})
