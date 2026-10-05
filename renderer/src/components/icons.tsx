// One drawn icon family: 20px grid, 1.6 stroke, round caps. Icons label
// nothing on their own; they sit beside words.
import type { ReactNode } from 'react';

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export const TrashIcon = () => <Icon size={16}><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 9.4A1.5 1.5 0 0 0 7.6 17h4.8a1.5 1.5 0 0 0 1.5-1.6L14.5 6" /></Icon>;
export const ChipRemoveIcon = () => <Icon size={12}><path d="M5 5l10 10M15 5 5 15" /></Icon>;
export const FolderIcon = () => <Icon><path d="M2.5 6.2A1.7 1.7 0 0 1 4.2 4.5h3.2l1.7 1.8h6.7a1.7 1.7 0 0 1 1.7 1.7v6.8a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7Z" /></Icon>;
export const DocumentIcon = () => <Icon><path d="M5 2.8h6.3L15 6.5v10.7H5Z" /><path d="M11.2 2.8v3.8H15M7.6 10.2h4.8M7.6 13.2h4.8" /></Icon>;
export const ZipIcon = () => <Icon><path d="M5 2.8h10v14.4H5Z" /><path d="M10 2.8v2M10 6.6v2M10 10.4h-1.4v3h2.8v-3Z" /></Icon>;
export const CheckIcon = () => <Icon><path d="m4.5 10.5 3.5 3.5 7.5-8" /></Icon>;
export const CrossIcon = () => <Icon><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></Icon>;
export const ClockIcon = () => <Icon><circle cx="10" cy="10" r="7" /><path d="M10 6.2V10l2.6 1.6" /></Icon>;
export const ArrowRightIcon = () => <Icon><path d="M4 10h11.5M11 5.5 15.5 10 11 14.5" /></Icon>;
export const AlertIcon = () => <Icon><path d="M10 3.2 17.4 16H2.6Z" /><path d="M10 8v3.6M10 13.9v.1" /></Icon>;
export const DownloadIcon = () => <Icon><path d="M10 3.5v9M6 8.8l4 4 4-4M4 16.5h12" /></Icon>;
export const KeyIcon = () => <Icon><circle cx="7" cy="12.5" r="3.2" /><path d="M9.3 10.2 16 3.5M13.5 6l1.8 1.8M11.8 7.7l1.4 1.4" /></Icon>;
export const RefreshIcon = () => <Icon><path d="M16 5.5v3.6h-3.6" /><path d="M15.6 9A6 6 0 1 0 14 13.8" /></Icon>;
export const BackIcon = () => <Icon><path d="M16 10H4.5M9 5.5 4.5 10 9 14.5" /></Icon>;
export const StopIcon = () => <Icon><rect x="5.2" y="5.2" width="9.6" height="9.6" rx="1.2" /></Icon>;

/** The TenderAssist mark: a file cover with its string tag. */
export function BrandMark() {
  return (
    <svg className="brand-mark" width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <rect x="3" y="3.5" width="17" height="20" rx="2.2" fill="currentColor" opacity="0.22" />
      <rect x="6" y="2" width="17" height="20" rx="2.2" fill="currentColor" />
      <rect x="9.5" y="7" width="10" height="1.8" rx="0.9" fill="var(--file)" />
      <rect x="9.5" y="10.6" width="7" height="1.8" rx="0.9" fill="var(--file)" />
      <circle cx="14.5" cy="17" r="2" fill="none" stroke="var(--file)" strokeWidth="1.6" />
    </svg>
  );
}
