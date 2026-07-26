import { ImageResponse } from 'next/og';

export const size = {
  width: 32,
  height: 32,
};
export const contentType = 'image/png';

/** Favicon: terminal amber N + down chevron on pure black (master 37 silhouette). */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#000000',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '7px',
          position: 'relative',
        }}
      >
        <span
          style={{
            fontSize: 18,
            color: '#c9a84c',
            fontWeight: 800,
            fontFamily: 'sans-serif',
            letterSpacing: '-0.04em',
            lineHeight: 1,
            display: 'flex',
            marginTop: -2,
          }}
        >
          N
        </span>
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            width: 10,
            height: 5,
            borderLeft: '1.5px solid #e4c566',
            borderBottom: '1.5px solid #e4c566',
            borderRight: '1.5px solid #e4c566',
            borderTop: 'none',
            transform: 'rotate(45deg) scale(0.55)',
            opacity: 0.95,
          }}
        />
      </div>
    ),
    {
      ...size,
    },
  );
}
