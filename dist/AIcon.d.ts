import type { IconName } from "./registry.js";
export interface AIconProps {
    name: IconName | string;
    size?: number;
    className?: string;
}
export declare function AIcon({ name, size, className }: AIconProps): import("react").JSX.Element | null;
