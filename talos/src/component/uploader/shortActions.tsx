import React, { memo } from 'react';
import classNames from 'classnames';
import PopoverTooltip from '@/component/popover/popover';
import styles from './shortActions.module.scss';

export type ShortActionItem = {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    iconClassName?: string;
    tooltipKey?: string;
};

type Props = {
    items: ShortActionItem[];
    className?: string;
};

const ShortActions = memo(({ items, className }: Props) => {
    if (items.length === 0) return null;

    return (
        <div
            className={classNames(styles.shortActions, className)}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            role="toolbar"
            aria-label="Image actions"
        >
            {items.map((item) => (
                <PopoverTooltip key={item.tooltipKey ?? item.id} content={item.label} placement="top" gap={4}>
                    <button
                        type="button"
                        className={styles.shortActionButton}
                        data-active={item.active ? 'true' : 'false'}
                        disabled={item.disabled}
                        onClick={(event) => {
                            event.stopPropagation();
                            item.onClick?.();
                        }}
                        aria-label={item.label}
                        aria-pressed={item.active || undefined}
                    >
                        <span className={classNames(styles.shortActionIcon, item.iconClassName)}>{item.icon}</span>
                    </button>
                </PopoverTooltip>
            ))}
        </div>
    );
});

ShortActions.displayName = 'ShortActions';

export default ShortActions;
