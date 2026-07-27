import { ImageResponse } from 'next/og';

export const size = {
  width: 32,
  height: 32,
};
export const contentType = 'image/png';

/** Favicon: champagne metal + crystal M↓ (SpringBoard master silhouette). */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(145deg, #e8d48a 0%, #c9a84c 40%, #a08839 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '7px',
          position: 'relative',
        }}
      >
        <span
          style={{
            fontSize: 17,
            color: '#f8f6f0',
            fontWeight: 900,
            fontFamily: 'sans-serif',
            letterSpacing: '-0.04em',
            lineHeight: 1,
            display: 'flex',
            marginTop: -2,
            textShadow: '0 1px 1px rgba(0,0,0,0.35)',
          }}
        >
          M
        </span>
        <div
          style={{
            display: 'flex',
            marginTop: 1,
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '5px solid #f5f0e4',
          }}
        />
      </div>
    ),
    {
      ...size,
    },
  );
}
