import { ImageResponse } from 'next/og';

export const alt = 'Shop by Brand — BuyWhere';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: 'linear-gradient(135deg, #064e3b 0%, #065f46 50%, #047857 100%)',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Inter, Arial, sans-serif',
          height: '100%',
          justifyContent: 'center',
          padding: '72px',
          width: '100%',
        }}
      >
        <div
          style={{
            color: '#6ee7b7',
            display: 'flex',
            fontSize: 36,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: 48,
          }}
        >
          BuyWhere
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 86,
            fontWeight: 800,
            letterSpacing: '-0.05em',
            lineHeight: 1,
            marginBottom: 32,
            textAlign: 'center',
          }}
        >
          Shop by Brand
        </div>
        <div
          style={{
            color: '#a7f3d0',
            display: 'flex',
            fontSize: 34,
            lineHeight: 1.3,
            maxWidth: 860,
            textAlign: 'center',
          }}
        >
          Find the best prices on Apple, Samsung, Sony, Nike, and more.
        </div>
        <div
          style={{
            background: '#34d399',
            borderRadius: 999,
            color: '#022c22',
            display: 'flex',
            fontSize: 28,
            fontWeight: 700,
            marginTop: 56,
            padding: '18px 32px',
          }}
        >
          Compare deals across every retailer.
        </div>
      </div>
    ),
    size
  );
}
