// Small inline icon set (stroke icons, 24px grid) so the app needs no icon font.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function make(path: React.ReactNode) {
  return function Icon({ size = 18, ...rest }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
        {path}
      </svg>
    );
  };
}

export const IconLibrary = make(<><path d="M4 5h4v14H4zM10 5h4v14h-4z" /><path d="m16.5 5.6 3.8-1 3 13.7-3.8 1z" transform="translate(-2.5 .6)" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const IconToc = make(<><path d="M4 6h16M4 12h11M4 18h14" /></>);
export const IconType = make(<><path d="M3 18 8 6l5 12M4.8 14h6.4" /><path d="M14.5 13.5c.4-1.3 1.5-2 3-2 1.9 0 3 1 3 2.9V18m0-2.2c-.6 1.4-1.8 2.2-3.2 2.2-1.4 0-2.4-.8-2.4-2s1.1-2 2.8-2h2.8" /></>);
export const IconPage = make(<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>);
export const IconBook = make(<><path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" /><path d="M12 6v13.5" /></>);
export const IconX = make(<path d="M6 6l12 12M18 6 6 18" />);
export const IconChevron = make(<path d="m9 6 6 6-6 6" />);
export const IconSparkle = make(<><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8-5.7-1.9L10.2 9z" /><path d="M19 3v3M17.5 4.5h3" /></>);
export const IconCopy = make(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>);
export const IconRefresh = make(<><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>);
export const IconTrash = make(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>);
export const IconStop = make(<rect x="7" y="7" width="10" height="10" rx="1.5" />);
export const IconOpen = make(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" /><path d="M3 7v10a2 2 0 0 0 2 2h13l3-8H6l-3 8" /></>);
export const IconBulb = make(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></>);
export const IconList = make(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>);
export const IconFeather = make(<><path d="M20 4c-6 0-12 4-13 12l-3 4" /><path d="M7 16h6c3 0 6-4 7-12" /></>);
export const IconQuestion = make(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></>);
export const IconImage = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m21 16-5-5-8 9" /></>);
