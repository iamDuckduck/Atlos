import React, { useCallback, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { openOemAuthModal } from '@/component/login/authEvents';
import {
    recallUGCImage,
    toggleUGCImageFlag,
    toggleUGCImageRecall,
    toggleUGCImageUpvote,
    UGCClientError,
} from '@/utils/ugcClient';
import { getUpvoteCount, type PointImagesState } from './useUGCPointImages';
import type { UploadState } from './useUGCUpload';

const isActionConflict = (err: unknown): boolean => (
    err instanceof UGCClientError && err.status === 409
);

export type ImageActionsState = {
    actionPending: boolean;
    viewerOpen: boolean;
    setViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleToggleUpvote: () => Promise<void>;
    handleToggleFlag: () => Promise<void>;
    handleToggleRecall: () => Promise<void>;
};

const useUGCImageActions = (imageState: PointImagesState, uploadState: UploadState): ImageActionsState => {
    const user = useAuthStore((state) => state.sessionUser);
    const isAuthenticated = Boolean(user);
    const [actionPending, setActionPending] = useState(false);
    const [viewerOpen, setViewerOpen] = useState(false);

    const {
        active,
        isOwnActive,
        isActivePending,
        patchActiveImage,
        applyServerImage,
        setImages,
        setMyImages,
        images,
        myImages,
        selectedImageId,
        setSelectedImageId,
    } = imageState;

    const { lastSubmission, setLastSubmission } = uploadState;

    const handleToggleUpvote = useCallback(async () => {
        if (!active || actionPending) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const nextUpvoted = !active.upvoted;
        const delta = nextUpvoted ? 1 : -1;
        patchActiveImage((image) => ({
            ...image,
            upvoted: nextUpvoted,
            upvotes: Math.max(0, getUpvoteCount(image) + delta),
            upvoteCount: Math.max(0, getUpvoteCount(image) + delta),
        }));
        setActionPending(true);
        try {
            applyServerImage(await toggleUGCImageUpvote(active.id, nextUpvoted));
        } catch {
            patchActiveImage((image) => ({
                ...image,
                upvoted: !nextUpvoted,
                upvotes: Math.max(0, getUpvoteCount(image) - delta),
                upvoteCount: Math.max(0, getUpvoteCount(image) - delta),
            }));
        } finally {
            setActionPending(false);
        }
    }, [actionPending, active, applyServerImage, isAuthenticated, patchActiveImage]);

    const handleToggleFlag = useCallback(async () => {
        if (!active || actionPending || isOwnActive) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        const nextFlagged = !active.flagged;
        patchActiveImage((image) => ({
            ...image,
            flagged: nextFlagged,
            status: nextFlagged ? 'flagged' : image.status === 'flagged' ? 'active' : image.status,
        }));
        setActionPending(true);
        try {
            applyServerImage(await toggleUGCImageFlag(active.id, nextFlagged));
        } catch {
            patchActiveImage((image) => ({
                ...image,
                flagged: !nextFlagged,
                status: !nextFlagged ? 'flagged' : image.status === 'flagged' ? 'active' : image.status,
            }));
        } finally {
            setActionPending(false);
        }
    }, [actionPending, active, applyServerImage, isAuthenticated, isOwnActive, patchActiveImage]);

    const handleToggleRecall = useCallback(async () => {
        if (!active || actionPending || !isOwnActive) return;
        if (!isAuthenticated) {
            openOemAuthModal('login');
            return;
        }
        if (isActivePending) {
            const previousSubmission = lastSubmission;
            const previousImages = images;
            const previousMyImages = myImages;
            const previousSelectedImageId = selectedImageId;
            const previousViewerOpen = viewerOpen;
            setLastSubmission(null);
            setImages((current) => current.filter((image) => image.id !== active.id));
            setMyImages((current) => current.filter((image) => image.id !== active.id));
            setSelectedImageId(null);
            setViewerOpen(false);
            setActionPending(true);
            try {
                const serverImage = await recallUGCImage(active.id);
                applyServerImage(serverImage);
            } catch {
                setLastSubmission(previousSubmission);
                setImages(previousImages);
                setMyImages(previousMyImages);
                setSelectedImageId(previousSelectedImageId);
                setViewerOpen(previousViewerOpen);
            } finally {
                setActionPending(false);
            }
            return;
        }
        const nextRecallRequested = !active.recallRequested && active.status !== 'remove_request';
        patchActiveImage((image) => ({
            ...image,
            recallRequested: nextRecallRequested,
            status: nextRecallRequested ? 'remove_request' : image.status === 'remove_request' ? 'active' : image.status,
        }));
        setActionPending(true);
        try {
            applyServerImage(await toggleUGCImageRecall(active.id, nextRecallRequested));
        } catch (err) {
            if (nextRecallRequested && isActionConflict(err)) {
                patchActiveImage((image) => ({
                    ...image,
                    recallRequested: true,
                    status: 'remove_request',
                }));
                return;
            }
            patchActiveImage((image) => ({
                ...image,
                recallRequested: !nextRecallRequested,
                status: !nextRecallRequested ? 'remove_request' : image.status === 'remove_request' ? 'active' : image.status,
            }));
        } finally {
            setActionPending(false);
        }
    }, [actionPending, active, applyServerImage, images, isActivePending, isAuthenticated, isOwnActive, lastSubmission, myImages, patchActiveImage, selectedImageId, setImages, setLastSubmission, setMyImages, setSelectedImageId, viewerOpen]);

    return {
        actionPending,
        viewerOpen,
        setViewerOpen,
        handleToggleUpvote,
        handleToggleFlag,
        handleToggleRecall,
    };
};

export default useUGCImageActions;
