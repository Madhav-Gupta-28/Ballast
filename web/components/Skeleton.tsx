/** Holds the exact space the real thing will take, so nothing jumps when it lands. */
export function SkeletonStats() {
  return (
    <div className="stats" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div className="stat" key={i}>
          <div className="sk sk-v" />
          <div className="sk sk-k" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ height = 300 }: { height?: number }) {
  return <div className="sk sk-block" style={{ height }} aria-hidden="true" />;
}
