export const meta = {
  name: "termlings-og",
  type: "image" as const,
  description: "OG image for termlings page",
  size: { width: 1200, height: 630 },
  props: {},
};

export default function TermlingsOG({ tw, image }) {
  const row1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const row2 = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

  return (
    <div style={tw("flex flex-col w-full h-full bg-black items-center justify-center")}>
      {/* Row 1 */}
      <div style={tw("flex justify-center items-end gap-3")}>
        {row1.map((i) => (
          <img key={i} src={image(`avatar-${i}.svg`)} width={68} height={68} />
        ))}
      </div>

      {/* Row 2 */}
      <div style={tw("flex justify-center items-end gap-3 mt-3 mb-8")}>
        {row2.map((i) => (
          <img key={i} src={image(`avatar-${i}.svg`)} width={68} height={68} />
        ))}
      </div>

      {/* Title */}
      <h1
        style={{
          ...tw("font-bold"),
          fontFamily: "monospace",
          color: "#d1fae5",
          fontSize: 84,
        }}
      >
        termlings
      </h1>
      <p
        style={{
          ...tw("mt-3"),
          fontFamily: "monospace",
          color: "rgba(209, 250, 229, 0.45)",
          fontSize: 28,
        }}
      >
        Pixel art avatars for the web and terminal.
      </p>
    </div>
  );
}
