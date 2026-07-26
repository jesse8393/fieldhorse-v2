// Landing — what a logged out visitor sees at fieldhorse.io.
//
// Before this screen existed, anonymous traffic hit a bare login wall:
// the worst possible first impression for a prospect clicking through
// from an email. Signed in users never see this (RequireAuth routes
// them straight into the app); deep links still bounce to /login.
//
// Self contained: inline styles only, no new CSS surface. Uses the
// existing brand tokens (Bebas display, DM Sans body, gold on onyx).

import { useNavigate } from 'react-router-dom'

const GOLD = 'var(--field-gold-bright, #E5C158)'
const GOLD_DEEP = 'var(--field-gold-deep, #C9963A)'
const INK = 'var(--v3-text, #F2EDE4)'
const MUTE = 'var(--v3-text-muted, #A89E8C)'
const CARD = 'rgba(255, 255, 255, 0.03)'
const LINE = 'rgba(201, 150, 58, 0.22)'

const FEATURES = [
  {
    title: 'Estimates that write themselves',
    body: 'Describe the scope in plain words. The AI prices it with real line items in seconds, one number from header to quote. Push it to a proposal and send it before you leave the driveway.'
  },
  {
    title: 'A schedule you can glance at',
    body: 'Day, week, and a real month calendar with your jobs on it. A pour weather forecast is built in, because slab day should not require three other apps.'
  },
  {
    title: 'Get paid without chasing',
    body: 'Invoices, payment logging, and an aging view that shows who owes you at a glance. The money side stays as simple as the work side.'
  }
]

export default function Landing() {
  const navigate = useNavigate()

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--v3-bg, #0B0907)',
        color: INK,
        fontFamily: 'var(--font-body)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Top bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px clamp(20px, 6vw, 64px)'
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            letterSpacing: '0.22em'
          }}
        >
          <span style={{ color: GOLD }}>FIELD</span>HORSE
        </span>
        <button
          type="button"
          onClick={() => navigate('/login')}
          style={{
            appearance: 'none',
            background: 'none',
            border: `1px solid ${LINE}`,
            borderRadius: 10,
            color: INK,
            padding: '9px 18px',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Sign in
        </button>
      </header>

      {/* Hero */}
      <section
        style={{
          padding: 'clamp(48px, 10vh, 110px) clamp(20px, 6vw, 64px) 24px',
          maxWidth: 980,
          width: '100%',
          margin: '0 auto',
          textAlign: 'center'
        }}
      >
        <p
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: GOLD,
            margin: 0
          }}
        >
          Built by a contractor
        </p>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(44px, 8vw, 92px)',
            lineHeight: 0.98,
            letterSpacing: '0.015em',
            margin: '18px 0 0'
          }}
        >
          Run the whole business
          <br />
          <span style={{ color: GOLD }}>from your pocket.</span>
        </h1>
        <p
          style={{
            fontSize: 'clamp(15px, 2vw, 18px)',
            lineHeight: 1.6,
            color: MUTE,
            maxWidth: 640,
            margin: '22px auto 0'
          }}
        >
          Leads, estimates, schedule, invoices, and jobs in one place.
          Built by a working general contractor who needed it, not by a
          software company guessing at what the trades do all day.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 14,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: 34
          }}
        >
          <button
            type="button"
            onClick={() => navigate('/login?mode=signup')}
            style={{
              appearance: 'none',
              border: 'none',
              borderRadius: 12,
              padding: '15px 30px',
              fontFamily: 'var(--font-display)',
              fontSize: 17,
              letterSpacing: '0.12em',
              color: 'var(--onyx, #17130C)',
              background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`,
              boxShadow: '0 10px 28px rgba(201, 150, 58, 0.35)',
              cursor: 'pointer'
            }}
          >
            CREATE A FREE ACCOUNT
          </button>
          <button
            type="button"
            onClick={() => navigate('/login')}
            style={{
              appearance: 'none',
              background: 'none',
              border: `1px solid ${LINE}`,
              borderRadius: 12,
              color: INK,
              padding: '15px 26px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Sign in
          </button>
        </div>
        <p style={{ fontSize: 13, color: MUTE, marginTop: 14 }}>
          Free while it is in polish. Your feedback shapes it.
        </p>
      </section>

      {/* Features */}
      <section
        style={{
          padding: '48px clamp(20px, 6vw, 64px)',
          maxWidth: 1080,
          width: '100%',
          margin: '0 auto'
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 18
          }}
        >
          {FEATURES.map((f) => (
            <article
              key={f.title}
              style={{
                background: CARD,
                border: `1px solid ${LINE}`,
                borderRadius: 14,
                padding: '26px 24px'
              }}
            >
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 24,
                  letterSpacing: '0.04em',
                  margin: 0,
                  color: GOLD
                }}
              >
                {f.title}
              </h2>
              <p
                style={{
                  fontSize: 14.5,
                  lineHeight: 1.65,
                  color: MUTE,
                  margin: '12px 0 0'
                }}
              >
                {f.body}
              </p>
            </article>
          ))}
        </div>

        {/* Solo mode line */}
        <div
          style={{
            marginTop: 18,
            border: `1px solid ${LINE}`,
            borderRadius: 14,
            padding: '22px 24px',
            background: CARD,
            textAlign: 'center'
          }}
        >
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: INK }}>
            <strong style={{ color: GOLD }}>Starts simple, grows when you do.</strong>{' '}
            Solo operators get a clean, focused app. Add your first crew
            member and the timesheets, tasks, and team screens appear on
            their own. No plans to pick, no switches to flip.
          </p>
        </div>
      </section>

      {/* Story */}
      <section
        style={{
          padding: '28px clamp(20px, 6vw, 64px) 64px',
          maxWidth: 760,
          width: '100%',
          margin: '0 auto',
          textAlign: 'center'
        }}
      >
        <p
          style={{
            fontSize: 'clamp(16px, 2.2vw, 19px)',
            lineHeight: 1.7,
            color: INK,
            margin: 0
          }}
        >
          I run Parker Construction in Tennessee. I built Fieldhorse
          because nothing out there fit a company my size without a
          sales call and a training week. You are not buying software
          from a vendor. You are using the same app I run my own jobs
          on, every day.
        </p>
        <p
          style={{
            marginTop: 16,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: MUTE
          }}
        >
          Jesse Parker · Founder
        </p>
      </section>

      {/* Footer */}
      <footer
        style={{
          marginTop: 'auto',
          borderTop: `1px solid ${LINE}`,
          padding: '22px clamp(20px, 6vw, 64px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: 13,
          color: MUTE
        }}
      >
        <span>Fieldhorse. Field operations for contractors.</span>
        <span style={{ display: 'flex', gap: 18 }}>
          <a href="/privacy" style={{ color: MUTE, textDecoration: 'none' }}>Privacy</a>
          <a href="/terms" style={{ color: MUTE, textDecoration: 'none' }}>Terms</a>
        </span>
      </footer>
    </main>
  )
}
