import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180,
};
export const contentType = 'image/png';

/** Apple touch icon: deep navy + gold geometric N with dual rings. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#07080b',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* Soft gold glow */}
        <div
          style={{
            position: 'absolute',
            width: 120,
            height: 120,
            borderRadius: '9999px',
            background: 'rgba(201, 168, 76, 0.12)',
            display: 'flex',
          }}
        />
        {/* Outer ring */}
        <div
          style={{
            position: 'absolute',
            width: 148,
            height: 148,
            borderRadius: '9999px',
            border: '3px solid rgba(201, 168, 76, 0.4)',
            display: 'flex',
          }}
        />
        {/* Inner ring */}
        <div
          style={{
            position: 'absolute',
            width: 118,
            height: 118,
            borderRadius: '9999px',
            border: '3px solid #e4c566',
            display: 'flex',
          }}
        />
        <span
          style={{
            fontSize: 88,
            color: '#c9a84c',
            fontWeight: 800,
            fontFamily: 'sans-serif',
            letterSpacing: '-0.04em',
            lineHeight: 1,
            display: 'flex',
          }}
        >
          N
        </span>
      </div>
    ),
    {
      ...size,
    },
  );
}
