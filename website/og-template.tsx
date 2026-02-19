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
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "linear-gradient(145deg, #04090a 0%, #0a1f1a 40%, #0d2818 70%, #04090a 100%)",
        fontFamily: "monospace",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle grid pattern */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          opacity: 0.06,
          backgroundImage:
            "linear-gradient(rgba(16,185,129,1) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Glow effect */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "600px",
          height: "600px",
          display: "flex",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)",
          transform: "translate(-50%, -50%)",
        }}
      />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "20px",
          zIndex: 1,
          padding: "0 80px",
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 20px",
            borderRadius: "999px",
            border: "1px solid rgba(16,185,129,0.3)",
            background: "rgba(16,185,129,0.08)",
          }}
        >
          <span style={{ fontSize: "22px" }}>⛳️</span>
          <span
            style={{
              fontSize: "16px",
              color: "rgba(167,243,208,0.9)",
              letterSpacing: "0.05em",
            }}
          >
            {badge}
          </span>
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: "52px",
            fontWeight: 700,
            color: "#ffffff",
            textAlign: "center",
            lineHeight: 1.15,
            margin: 0,
          }}
        >
          {title}
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: "22px",
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
            marginTop: "12px",
            padding: "14px 28px",
            borderRadius: "10px",
            border: "1px solid rgba(16,185,129,0.25)",
            background: "rgba(0,0,0,0.5)",
          }}
        >
          <code
            style={{
              fontSize: "17px",
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
