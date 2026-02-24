export const meta = {
  name: "termlings-video",
  type: "video" as const,
  description: "Animated promo video for termlings",
  size: { width: 1080, height: 1080 },
  props: {},
  video: {
    fps: 30,
    duration: 4,
  },
};

export default function TermlingsVideo({ tw, image }) {
  // Row 1: 8 avatars, staggered pop-in
  const row1 = [0, 1, 2, 3, 4, 5, 6, 7];
  // Row 2: 8 avatars
  const row2 = [8, 9, 10, 11, 12, 13, 14, 15];
  // Row 3: 8 avatars
  const row3 = [16, 17, 18, 19, 20, 21, 22, 23];

  const avatarSize = 90;

  return (
    <div style={tw("flex flex-col w-full h-full bg-black items-center justify-center")}>

      {/* Title — appears first */}
      <h1
        style={{
          ...tw("font-bold ease-out enter-fade-in-up/0/600"),
          fontFamily: "monospace",
          color: "#d1fae5",
          fontSize: 72,
          marginBottom: 8,
        }}
      >
        termlings
      </h1>
      <p
        style={{
          ...tw("ease-out enter-fade-in-up/200/500"),
          fontFamily: "monospace",
          color: "rgba(209, 250, 229, 0.45)",
          fontSize: 24,
          marginBottom: 48,
        }}
      >
        Cute pixel creatures for web and terminal.
      </p>

      {/* Row 1 */}
      <div style={tw("flex justify-center items-end gap-2")}>
        {row1.map((i) => (
          <img
            key={i}
            style={tw(`ease-out enter-scale-in/${600 + i * 80}/400`)}
            src={image(`avatar-${i}.svg`)} width={avatarSize} height={avatarSize}
          />
        ))}
      </div>

      {/* Row 2 */}
      <div style={tw("flex justify-center items-end gap-2 mt-2")}>
        {row2.map((i) => (
          <img
            key={i}
            style={tw(`ease-out enter-scale-in/${1000 + (i - 8) * 80}/400`)}
            src={image(`avatar-${i}.svg`)} width={avatarSize} height={avatarSize}
          />
        ))}
      </div>

      {/* Row 3 */}
      <div style={tw("flex justify-center items-end gap-2 mt-2")}>
        {row3.map((i) => (
          <img
            key={i}
            style={tw(`ease-out enter-scale-in/${1400 + (i - 16) * 80}/400`)}
            src={image(`avatar-${i}.svg`)} width={avatarSize} height={avatarSize}
          />
        ))}
      </div>

      {/* npm install line at bottom */}
      <p
        style={{
          ...tw("ease-out enter-fade-in/2800/500"),
          fontFamily: "monospace",
          color: "rgba(209, 250, 229, 0.6)",
          fontSize: 22,
          marginTop: 48,
        }}
      >
        npm install termlings
      </p>
    </div>
  );
}
