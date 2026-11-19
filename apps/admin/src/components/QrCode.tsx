import { encode } from 'uqr';

/** QR code drawn as SVG rectangles (no injected HTML); black on white for scanners in any theme. */
export function QrCode({
  value,
  label,
  size = 200,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { data } = encode(value, { ecc: 'M', border: 2 });
  const modules = data.length;
  const rects = [];
  for (let y = 0; y < modules; y += 1) {
    const row = data[y] ?? [];
    for (let x = 0; x < modules; x += 1) {
      if (row[x]) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
    }
  }
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      style={{ background: '#fff' }}
    >
      <rect width={modules} height={modules} fill="#fff" />
      <g fill="#000">{rects}</g>
    </svg>
  );
}
