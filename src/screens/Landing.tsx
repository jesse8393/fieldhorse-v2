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

      {/* Product preview — a drawn miniature of the owner dashboard.
          Pure markup, no image asset: always crisp, themes with the
          tokens, and costs nothing to load. Numbers are illustrative
          sample data (aria-hidden; the caption carries the meaning). */}
      <section
        style={{
          padding: '8px clamp(20px, 6vw, 64px) 20px',
          maxWidth: 920,
          width: '100%',
          margin: '0 auto'
        }}
      >
        <p
          style={{
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: MUTE,
            margin: '0 0 16px'
          }}
        >
          Your pipeline, schedule, and money on one screen
        </p>
        <div
          aria-hidden="true"
          style={{
            border: `1px solid ${LINE}`,
            borderRadius: 18,
            background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.015))',
            boxShadow: '0 30px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(201, 150, 58, 0.06)',
            padding: 'clamp(14px, 3vw, 26px)',
            overflow: 'hidden'
          }}
        >
          {/* Mock topbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            {['#C0392B', '#D4A042', '#7BB58E'].map((c) => (
              <span key={c} style={{ width: 9, height: 9, borderRadius: '50%', background: c, opacity: 0.75 }} />
            ))}
            <span
              style={{
                marginLeft: 10,
                fontFamily: 'var(--font-display)',
                fontSize: 13,
                letterSpacing: '0.2em',
                color: MUTE
              }}
            >
              <span style={{ color: GOLD_DEEP }}>FIELD</span>HORSE
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: 14
            }}
          >
            {/* Pipeline card */}
            <div
              style={{
                border: `1px solid ${LINE}`,
                borderRadius: 14,
                padding: '18px 18px 16px',
                background: 'rgba(0, 0, 0, 0.25)'
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: MUTE }}>
                Active pipeline
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(30px, 5vw, 40px)',
                  color: GOLD,
                  lineHeight: 1,
                  margin: '10px 0 14px',
                  textShadow: '0 0 18px rgba(229, 193, 88, 0.25)'
                }}
              >
                $184,500
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  ['Lead', '$22K', '3 deals'],
                  ['Active', '$118K', '4 deals'],
                  ['Invoicing', '$44K', '2 deals']
                ].map(([label, amt, n]) => (
                  <div
                    key={label}
                    style={{
                      border: `1px solid rgba(201, 150, 58, 0.16)`,
                      borderRadius: 9,
                      padding: '8px 9px',
                      background: 'rgba(255, 255, 255, 0.02)'
                    }}
                  >
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTE }}>{label}</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: INK, margin: '4px 0 2px' }}>{amt}</div>
                    <div style={{ fontSize: 9.5, color: MUTE }}>{n}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Owner queue card */}
            <div
              style={{
                border: `1px solid ${LINE}`,
                borderRadius: 14,
                padding: '18px 18px 14px',
                background: 'rgba(0, 0, 0, 0.25)',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: MUTE, marginBottom: 12 }}>
                Owner queue
              </div>
              {[
                ['Send the Hensley deck quote', 'Today', '#D4A042'],
                ['Collect the Maple St balance', '3d waiting', '#C0392B'],
                ['Schedule the Ridgeline pour', 'This week', '#7BB58E']
              ].map(([title, due, tone]) => (
                <div
                  key={title}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 10px',
                    borderRadius: 9,
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    background: 'rgba(255, 255, 255, 0.02)',
                    marginBottom: 7
                  }}
                >
                  <span style={{ width: 3, height: 16, borderRadius: 2, background: tone, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: INK, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                  <span style={{ fontSize: 10, color: MUTE, flexShrink: 0 }}>{due}</span>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
                {[
                  ['3', 'On site'],
                  ['9', 'Open deals'],
                  ['$8.2K', 'This week']
                ].map(([v, l]) => (
                  <div key={l} style={{ textAlign: 'center', padding: '7px 4px', borderRadius: 9, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: GOLD }}>{v}</div>
                    <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: MUTE, marginTop: 2 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <p style={{ textAlign: 'center', fontSize: 11.5, color: MUTE, margin: '10px 0 0' }}>
          Sample numbers shown. Your dashboard fills with your own jobs.
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
