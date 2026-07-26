import { ImageResponse } from 'next/og';

export const size = {
  width: 180,
  height: 180,
};
export const contentType = 'image/png';

/** Apple touch icon: pure black + amber N + down chevron (master 37 silhouette). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#000000',
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
            fontSize: 100,
            color: '#c9a84c',
            fontWeight: 800,
            fontFamily: 'sans-serif',
            letterSpacing: '-0.05em',
            lineHeight: 1,
            display: 'flex',
            marginTop: -8,
          }}
        >
          N
        </span>
        {/* Down chevron — reverse auction signal */}
        <div
          style={{
            display: 'flex',
            marginTop: 4,
            width: 0,
            height: 0,
            borderLeft: '14px solid transparent',
            borderRight: '14px solid transparent',
            borderTop: '16px solid #e4c566',
          }}
        />
      </div>
    ),
    {
      ...size,
    },
  );
}
