import { ImageResponse } from 'next/og';

export const size = {
  width: 32,
  height: 32,
};
export const contentType = 'image/png';

/** Favicon: deep navy + gold geometric N with dual rings (code-generated). */
export default function Icon() {
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
          borderRadius: '7px',
          position: 'relative',
        }}
      >
        {/* Outer ring */}
        <div
          style={{
            position: 'absolute',
            width: 28,
            height: 28,
            borderRadius: '9999px',
            border: '1.5px solid rgba(201, 168, 76, 0.45)',
            display: 'flex',
          }}
        />
        {/* Inner ring */}
        <div
          style={{
            position: 'absolute',
            width: 22,
            height: 22,
            borderRadius: '9999px',
            border: '1.5px solid #e4c566',
            display: 'flex',
          }}
        />
        <span
          style={{
            fontSize: 16,
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
