import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { useTranslateUI } from '@/locale';
import { openOemAuthModal } from '@/component/login/authEvents';
import type { IMarkerData } from '@/data/marker';
import {
    listUGCImages,
    listUGCMyImages,
    uploadUGCImage,
    UGCClientError,
    type UGCUploadSubmission,
} from '@/utils/ugcClient';
import type { PointImagesState } from './useUGCPointImages';

export type UploadState = {
    uploading: boolean;
    progress: number;
    error: string | null;
    lastSubmission: UGCUploadSubmission | null;
    setLastSubmission: React.Dispatch<React.SetStateAction<UGCUploadSubmission | null>>;
    inputRef: React.RefObject<HTMLInputElement | null>;
    canUpload: boolean;
    requestUpload: () => void;
    upload: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
    uploadFile: (file: File) => Promise<void>;
};

const useUGCUpload = (point: IMarkerData, imageState: PointImagesState): UploadState => {
    const tUI = useTranslateUI();
    const user = useAuthStore((state) => state.sessionUser);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [lastSubmission, setLastSubmission] = useState<UGCUploadSubmission | null>(null);
    const [pendingLoginUpload, setPendingLoginUpload] = useState(false);

    const { target, loading, setImages, setMyImages, pendingOwn, active } = imageState;
    const state = pendingOwn || lastSubmission?.status === 'pending_openai' || lastSubmission?.status === 'pending_audit'
        ? 'pending'
        : active
            ? 'hasImage'
            : 'noImage';
    const canUpload = Boolean(target) && !loading && state !== 'hasImage' && state !== 'pending' && !uploading;

    const errText = useCallback((err: unknown): string => {
        if (err instanceof UGCClientError) {
            const translated = tUI(`detail.errors.${err.code}`);
            const fallback = tUI(err.status ? 'detail.errors.backendUnknown' : 'detail.errors.uploadFailed');
            return typeof translated === 'string' && translated
                ? translated
                : String(fallback || 'Upload failed.');
        }

        return String(tUI('detail.errors.uploadFailed') || 'Upload failed.');
    }, [tUI]);

    useEffect(() => {
        setError(null);
        setLastSubmission(null);
    }, [point.id]);

    useEffect(() => {
        if (!pendingLoginUpload || !user) return;
        setPendingLoginUpload(false);
        requestAnimationFrame(() => inputRef.current?.click());
    }, [pendingLoginUpload, user]);

    const uploadFile = useCallback(async (file: File) => {
        if (!file || !target) return;

        setUploading(true);
        setProgress(0.02);
        setError(null);
        setLastSubmission(null);
        try {
            const submission = await uploadUGCImage(target, file, setProgress);
            setLastSubmission(submission);
            const [nextImages, nextMyImages] = await Promise.allSettled([
                listUGCImages(point.id),
                listUGCMyImages(point.id),
            ]);
            if (nextImages.status === 'fulfilled') {
                setImages(nextImages.value);
            }
            if (nextMyImages.status === 'fulfilled') {
                setMyImages(nextMyImages.value);
            }
        } catch (err) {
            setLastSubmission(null);
            setError(errText(err));
        } finally {
            setUploading(false);
            setProgress(0);
        }
    }, [errText, point.id, setImages, setMyImages, target]);

    const upload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        await uploadFile(file);
    }, [uploadFile]);

    const requestUpload = useCallback(() => {
        if (!canUpload) return;
        setError(null);
        if (!user) {
            setPendingLoginUpload(true);
            openOemAuthModal('login');
            return;
        }
        inputRef.current?.click();
    }, [canUpload, user]);

    return {
        uploading,
        progress,
        error,
        lastSubmission,
        setLastSubmission,
        inputRef,
        canUpload,
        requestUpload,
        upload,
        uploadFile,
    };
};

export default useUGCUpload;
