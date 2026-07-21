import type { SVGProps } from 'react';

// The shared Lira mark is the lyre already approved for the main navigation.
// Explicit path fills keep global icon rules from turning its open frame solid.
export const LiraMark = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    {...props}
    aria-hidden="true"
    data-lira-mark
  >
    <path
      d="M9.7 9.6v6.7M12 9.6v7.4M14.3 9.6v6.7"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.95"
      strokeLinecap="round"
      opacity="0.78"
    />
    <path
      d="M6.8 9h10.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
    />
    <path
      d="M8.7 19C6.5 15.3 5.5 11.9 5.5 8.7c0-2.1 1.1-3.4 2.8-3.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M15.3 19c2.2-3.7 3.2-7.1 3.2-10.3 0-2.1-1.1-3.4-2.8-3.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
