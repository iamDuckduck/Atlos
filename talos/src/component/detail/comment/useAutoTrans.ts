import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { getTargetLang } from '@/utils/lang';
import { transUGCComments, type UGCComment } from '@/utils/ugcClient';
import { flatList, isVisible } from './commentsTree';

const AUTO_TRANS_TARGET_LANGS = new Set(['zh-cn', 'en-us', 'ru-ru', 'ja-jp', 'ko-kr']);
const ZH_HANT_AUTO_DISPLAY_TARGET_LANG = 'zh-cn';

type AutoTransRequest = {
    cachedOnly: boolean;
    skipChineseSource: boolean;
    targetLang: string;
};

const isTraditionalChineseTarget = (targetLang: string): boolean => (
    targetLang === 'zh-hk'
    || targetLang === 'zh-tw'
    || targetLang.startsWith('zh-hant')
);

const isChineseSource = (sourceLang?: string): boolean => {
    const normalized = sourceLang?.trim().replace('_', '-').toLowerCase();
    return Boolean(normalized && (normalized === 'zh' || normalized.startsWith('zh-')));
};

const getAutoTransRequest = (locale: string): AutoTransRequest | null => {
    const targetLang = getTargetLang(locale);
    if (isTraditionalChineseTarget(targetLang)) {
        return {
            cachedOnly: true,
            skipChineseSource: true,
            targetLang: ZH_HANT_AUTO_DISPLAY_TARGET_LANG,
        };
    }
    if (!AUTO_TRANS_TARGET_LANGS.has(targetLang)) return null;
    return {
        cachedOnly: false,
        skipChineseSource: false,
        targetLang,
    };
};

const applyAutoTrans = (
    comments: UGCComment[],
    trans: Awaited<ReturnType<typeof transUGCComments>>,
    request: AutoTransRequest,
): UGCComment[] => {
    const transById = new Map(
        trans
            .filter((item) => (
                item.translatedContent
                && !(request.skipChineseSource && isChineseSource(item.sourceLanguage))
            ))
            .map((item) => [item.commentId, item] as const),
    );
    if (transById.size === 0) return comments;

    const applyTo = (items: UGCComment[]): UGCComment[] => (
        items.map((comment) => {
            const transItem = transById.get(comment.id);
            const replies = comment.replies.length > 0 ? applyTo(comment.replies) : comment.replies;
            if (!transItem) {
                return replies === comment.replies ? comment : { ...comment, replies };
            }

            return {
                ...comment,
                replies,
                translatedContent: transItem.translatedContent,
                translationSourceLanguage: transItem.sourceLanguage,
                translationTargetLanguage: transItem.targetLanguage,
                translationHidden: false,
                translationStatus: undefined,
            };
        })
    );

    return applyTo(comments);
};

const clearSkippedAutoTrans = (
    comments: UGCComment[],
    request: AutoTransRequest,
): UGCComment[] => {
    if (!request.skipChineseSource) return comments;

    let changed = false;
    const applyTo = (items: UGCComment[]): UGCComment[] => (
        items.map((comment) => {
            const replies = comment.replies.length > 0 ? applyTo(comment.replies) : comment.replies;
            const shouldClear = (
                comment.translationTargetLanguage?.toLowerCase() === request.targetLang
                && isChineseSource(comment.translationSourceLanguage)
            );
            if (!shouldClear) {
                if (replies === comment.replies) return comment;
                changed = true;
                return { ...comment, replies };
            }

            changed = true;
            return {
                ...comment,
                replies,
                translatedContent: undefined,
                translationSourceLanguage: undefined,
                translationTargetLanguage: undefined,
                translationHidden: undefined,
                translationStatus: undefined,
            };
        })
    );

    const nextComments = applyTo(comments);
    return changed ? nextComments : comments;
};

export const useAutoTrans = ({
    comments,
    enabled = true,
    locale,
    scopeKey,
    setComments,
}: {
    comments: UGCComment[];
    enabled?: boolean;
    locale: string;
    scopeKey: string;
    setComments: Dispatch<SetStateAction<UGCComment[]>>;
}) => {
    const requestRef = useRef('');

    useEffect(() => {
        if (!enabled || !scopeKey) return;

        const request = getAutoTransRequest(locale);
        if (!request) return;

        setComments((current) => clearSkippedAutoTrans(current, request));

        const { cachedOnly, targetLang } = request;
        const commentIds = flatList(comments)
            .filter((comment) => isVisible(comment.status))
            .filter((comment) => !(
                comment.translatedContent
                && comment.translationTargetLanguage?.toLowerCase() === targetLang
            ))
            .map((comment) => comment.id);
        if (commentIds.length === 0) return;

        const requestKey = `${scopeKey}:${targetLang}:${cachedOnly ? 'cache' : 'translate'}:${commentIds.join(',')}`;
        if (requestRef.current === requestKey) return;
        requestRef.current = requestKey;

        let disposed = false;
        void transUGCComments(commentIds, targetLang, { cachedOnly })
            .then((items) => {
                if (disposed) return;
                setComments((current) => applyAutoTrans(current, items, request));
            })
            .catch(() => {
                // Auto translation is opportunistic; keep original comments on failure.
            });

        return () => {
            disposed = true;
        };
    }, [comments, enabled, locale, scopeKey, setComments]);
};
