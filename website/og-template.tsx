export const meta = {
  title: "OG Image",
  size: {
    width: 1200,
    height: 630,
  },
};

interface Props {
  title: string;
  subtitle: string;
  badge: string;
}

export default function OGImage({ title, subtitle, badge }: Props) {
  // Generate ASCII sky characters (sparse dots and apostrophes)
  const skyChars: { x: number; y: number; ch: string }[] = [];
  const rng = (seed: number) => {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  };
  const r = rng(42);
  for (let i = 0; i < 120; i++) {
    skyChars.push({
      x: Math.floor(r() * 1200),
      y: Math.floor(r() * 320),
      ch: [".", "'", ":", ".", "*", "+", "."][Math.floor(r() * 7)],
    });
  }

  // Generate ASCII grass characters along the bottom
  const grassChars: { x: number; y: number; ch: string }[] = [];
  const grassSet = ["'", ",", ";", ":", ".", "^", "'", ","];
  for (let i = 0; i < 200; i++) {
    grassChars.push({
      x: Math.floor(r() * 1200),
      y: 530 + Math.floor(r() * 100),
      ch: grassSet[Math.floor(r() * grassSet.length)],
    });
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "#04090a",
        fontFamily: "Geist Mono, monospace",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ASCII sky dots */}
      {skyChars.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${s.x}px`,
            top: `${s.y}px`,
            fontSize: "14px",
            color:
              s.ch === "*" || s.ch === "+"
                ? "rgba(104,182,255,0.7)"
                : "rgba(104,182,255,0.35)",
            display: "flex",
          }}
        >
          {s.ch}
        </span>
      ))}

      {/* ASCII grass along bottom */}
      {grassChars.map((g, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${g.x}px`,
            top: `${g.y}px`,
            fontSize: "14px",
            color: "rgba(14,209,149,0.6)",
            display: "flex",
          }}
        >
          {g.ch}
        </span>
      ))}

      {/* Subtle emerald glow behind content */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "500px",
          height: "400px",
          display: "flex",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)",
          transform: "translate(-50%, -50%)",
        }}
      />

      {/* Main content card */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "20px",
          zIndex: 1,
          padding: "40px 60px",
          borderRadius: "12px",
          border: "1px solid rgba(167,243,208,0.2)",
          background: "rgba(0,0,0,0.5)",
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <span style={{ fontSize: "24px" }}>⛳️</span>
          <span
            style={{
              fontSize: "18px",
              fontFamily: "Geist Mono, monospace",
              color: "rgba(167,243,208,0.95)",
              letterSpacing: "0.08em",
            }}
          >
            {badge}
          </span>
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: "48px",
            fontFamily: "Geist Mono, monospace",
            fontWeight: 700,
            color: "#ffffff",
            textAlign: "center",
            lineHeight: 1.2,
            margin: 0,
            maxWidth: "900px",
          }}
        >
          {title}
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: "20px",
            fontFamily: "Geist, sans-serif",
            color: "rgba(167,243,208,0.75)",
            textAlign: "center",
            lineHeight: 1.5,
            margin: 0,
            maxWidth: "700px",
          }}
        >
          {subtitle}
        </p>

        {/* Install command */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: "8px",
            padding: "12px 24px",
            borderRadius: "8px",
            border: "1px solid rgba(167,243,208,0.2)",
            background: "rgba(0,0,0,0.6)",
          }}
        >
          <code
            style={{
              fontSize: "16px",
              color: "rgba(167,243,208,0.85)",
              letterSpacing: "0.01em",
            }}
          >
            curl -fsSL https://touchgrass.sh/install.sh | bash
          </code>
        </div>
      </div>
    </div>
  );
}
