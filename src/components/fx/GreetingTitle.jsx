export default function GreetingTitle({ prefix = 'Morning,', name = 'there' }) {
  return (
    <h1
      className="fh-font-serif"
      style={{
        fontSize: 'clamp(32px, 8vw, 42px)',
        lineHeight: 1,
        letterSpacing: '-0.02em',
        margin: 0,
        fontWeight: 400
      }}
    >
      {prefix}
      <br />
      <em className="fh-font-serif-italic fh-text-gradient-gold">{name}.</em>
    </h1>
  )
}
