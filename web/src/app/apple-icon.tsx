import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180,
};
export const contentType = 'image/png';

/** Apple touch icon: champagne metal + crystal M↓ (homescreen master). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(145deg, #f0dfa0 0%, #d4b55a 35%, #c9a84c 60%, #a08839 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <span
          style={{
            fontSize: 96,
            color: '#faf8f4',
            fontWeight: 900,
            fontFamily: 'sans-serif',
            letterSpacing: '-0.05em',
            lineHeight: 1,
            display: 'flex',
            marginTop: -12,
            textShadow: '0 2px 4px rgba(0,0,0,0.35)',
          }}
        >
          M
        </span>
        <div
          style={{
            display: 'flex',
            marginTop: 2,
            width: 0,
            height: 0,
            borderLeft: '16px solid transparent',
            borderRight: '16px solid transparent',
            borderTop: '18px solid #f5f0e4',
          }}
        />
        <span
          style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.92)',
            fontWeight: 600,
            fontFamily: 'sans-serif',
            marginTop: 10,
            letterSpacing: '0.02em',
            display: 'flex',
          }}
        >
          NoMarkup
        </span>
      </div>
    ),
    {
      ...size,
    },
  );
}
