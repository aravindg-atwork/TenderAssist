// One icon family (Phosphor, regular weight, 18px by default). Icons label
// nothing on their own; they sit beside words. Names stay stable for the screens.
import {
  ArrowClockwiseIcon, ArrowLeftIcon, ChartBarIcon, ArrowRightIcon as PhArrowRight, CalendarBlankIcon, CheckIcon as PhCheck, ClockCounterClockwiseIcon,
  ClockIcon as PhClock, DotsThreeIcon, DownloadSimpleIcon, FileTextIcon, FileZipIcon, FolderIcon as PhFolder, GearSixIcon, GlobeIcon as PhGlobe,
  KeyIcon as PhKey, ListBulletsIcon, MagnifyingGlassIcon, NotePencilIcon, PackageIcon, PlusIcon as PhPlus, SparkleIcon, StackIcon as PhStack,
  StopIcon as PhStop, TrashIcon as PhTrash, TrayIcon, WarningIcon, XIcon, type Icon as PhIcon,
} from '@phosphor-icons/react';

const make = (Glyph: PhIcon, size = 18, weight: 'regular' | 'bold' | 'fill' = 'regular') =>
  function IconGlyph() { return <Glyph className="icon" size={size} weight={weight} aria-hidden="true" />; };

export const TrashIcon = make(PhTrash, 16);
export const ChipRemoveIcon = make(XIcon, 12, 'bold');
export const FolderIcon = make(PhFolder);
export const DocumentIcon = make(FileTextIcon);
export const ZipIcon = make(FileZipIcon);
export const CheckIcon = make(PhCheck, 18, 'bold');
export const CrossIcon = make(XIcon, 18, 'bold');
export const ClockIcon = make(PhClock);
export const ArrowRightIcon = make(PhArrowRight, 18, 'bold');
export const AlertIcon = make(WarningIcon);
export const DownloadIcon = make(DownloadSimpleIcon);
export const KeyIcon = make(PhKey);
export const RefreshIcon = make(ArrowClockwiseIcon);
export const BackIcon = make(ArrowLeftIcon);
export const StopIcon = make(PhStop);
export const TodayIcon = make(TrayIcon, 20);
export const StackIcon = make(PhStack, 20);
export const HistoryIcon = make(ClockCounterClockwiseIcon, 20);
export const SettingsIcon = make(GearSixIcon, 20);
export const ReportIcon = make(ChartBarIcon, 20);
export const SearchIcon = make(MagnifyingGlassIcon);
export const PlusIcon = make(PhPlus, 16, 'bold');
export const GlobeIcon = make(PhGlobe);
export const CalendarIcon = make(CalendarBlankIcon);
export const MoreIcon = make(DotsThreeIcon, 20, 'bold');
export const SparkIcon = make(SparkleIcon);
export const ListIcon = make(ListBulletsIcon);
export const NoteIcon = make(NotePencilIcon);
export const ParcelIcon = make(PackageIcon);

/** The TenderAssist mark: a round date postmark, in postbox red. */
export function BrandMark() {
  return (
    <svg className="brand-mark" width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r="15.5" fill="var(--red)" />
      <circle cx="17" cy="17" r="11.6" fill="none" stroke="#fff" strokeWidth="1.4" strokeDasharray="2.2 1.6" />
      <text x="17" y="21.2" textAnchor="middle" fill="#fff" fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" fontSize="12.5" letterSpacing="0.3">TA</text>
    </svg>
  );
}
