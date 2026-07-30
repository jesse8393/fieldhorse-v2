export default function GreetingTitle({ prefix = 'Morning,', name = 'there' }: { prefix?: string; name?: string }) {
  return (
    <h1
      className="fh-font-serif"
      style={{
        fontSize: 24,
        lineHeight: 1,
        letterSpacing: 0,
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
