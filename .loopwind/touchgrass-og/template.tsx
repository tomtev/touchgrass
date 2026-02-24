export const meta = {
  name: "touchgrass-og",
  type: "image" as const,
  description: "OG image for touchgrass.sh",
  size: { width: 1200, height: 630 },
  props: {},
};

export default function TouchgrassOG({ tw, image }) {
  return (
    <div style={tw("flex flex-col w-full h-full bg-black items-center justify-center")}>
      {/* Avatar */}
      <img src={image("avatar.svg")} width={120} height={120} style={tw("mb-8")} />

      {/* Title */}
      <h1
        style={{
          ...tw("font-bold"),
          fontFamily: "monospace",
          color: "#d1fae5",
          fontSize: 80,
        }}
      >
        touchgrass.sh
      </h1>
      <p
        style={{
          ...tw("mt-4"),
          fontFamily: "monospace",
          color: "rgba(209, 250, 229, 0.45)",
          fontSize: 28,
        }}
      >
        Remote control AI coding tools from Telegram.
      </p>
    </div>
  );
}
