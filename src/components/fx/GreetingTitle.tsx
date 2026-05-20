export default function GreetingTitle({ prefix = 'Morning,', name = 'there' }: { prefix?: string; name?: string }) {
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
      {name}.
    </h1>
  )
}
