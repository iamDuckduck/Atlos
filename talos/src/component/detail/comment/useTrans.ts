import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { getTargetLang } from '@/locale';
import { transUGCComments, type UGCComment } from '@/utils/ugcClient';
import { clearAllTrans, clearTrans } from './commentsTree';
import { isSameLangErr } from './commentsUtils';

type Args = {
    locale: string;
    busyIds: Set<string>;
    patch: (commentId: string, patch: (comment: UGCComment) => UGCComment) => void;
    setBusy: (commentId: string, pending: boolean) => void;
    setComments: Dispatch<SetStateAction<UGCComment[]>>;
    setReply: Dispatch<SetStateAction<UGCComment | null>>;
    setRendered: Dispatch<SetStateAction<UGCComment | null>>;
};

export const useTrans = ({
    locale,
    busyIds,
    patch,
    setBusy,
    setComments,
    setReply,
    setRendered,
}: Args) => {
    const targetLang = getTargetLang(locale);
    const targetRef = useRef(targetLang);

    useEffect(() => {
        if (targetRef.current === targetLang) return;
        targetRef.current = targetLang;
        setComments(clearAllTrans);
        setReply((current) => (current ? clearTrans(current) : null));
        setRendered((current) => (current ? clearTrans(current) : null));
    }, [setComments, setRendered, setReply, targetLang]);

    const translate = useCallback((comment: UGCComment) => {
        if (busyIds.has(comment.id)) return;
        const hasCurrent = Boolean(
            comment.translatedContent && comment.translationTargetLanguage === targetLang,
        );
        if (hasCurrent) {
            patch(comment.id, (current) => ({
                ...current,
                translationHidden: !current.translationHidden,
                translationStatus: undefined,
            }));
            return;
        }
        if (comment.translatedContent && !comment.translationHidden) {
            patch(comment.id, (current) => ({
                ...current,
                translationHidden: true,
                translationStatus: undefined,
            }));
            return;
        }

        patch(comment.id, (current) => ({
            ...current,
            translatedContent: undefined,
            translationSourceLanguage: undefined,
            translationTargetLanguage: targetLang,
            translationHidden: false,
            translationStatus: 'translating',
        }));
        setBusy(comment.id, true);
        void transUGCComments([comment.id], targetLang)
            .then((items) => {
                const item = items.find((entry) => entry.commentId === comment.id);
                if (!item?.translatedContent) {
                    patch(comment.id, (current) => {
                        if (current.translationTargetLanguage !== targetLang) return current;
                        if (item && isSameLangErr(item.error)) {
                            return clearTrans(current);
                        }
                        return {
                            ...current,
                            translationStatus: 'failed',
                        };
                    });
                    return;
                }
                patch(comment.id, (current) => {
                    if (current.translationTargetLanguage !== targetLang) return current;
                    return {
                        ...current,
                        translatedContent: item.translatedContent,
                        translationSourceLanguage: item.sourceLanguage,
                        translationTargetLanguage: targetLang,
                        translationHidden: false,
                        translationStatus: undefined,
                    };
                });
            })
            .catch(() => {
                patch(comment.id, (current) => (
                    current.translationTargetLanguage === targetLang
                        ? { ...current, translationStatus: 'failed' }
                        : current
                ));
            })
            .finally(() => setBusy(comment.id, false));
    }, [busyIds, patch, setBusy, targetLang]);

    return translate;
};
