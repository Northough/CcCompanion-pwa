import { useState, useEffect } from 'react';

const KEYS = {
  userName: 'cc_profile_userName',
  userAvatar: 'cc_profile_userAvatar',
  claudeName: 'cc_profile_claudeName',
  claudeAvatar: 'cc_profile_claudeAvatar',
};

export interface Profile {
  userName: string;
  userAvatar: string;   // data URL or emoji or empty
  claudeName: string;
  claudeAvatar: string;  // data URL or emoji or empty
}

const DEFAULTS: Profile = {
  userName: 'Me',
  userAvatar: '',
  claudeName: 'Claude',
  claudeAvatar: '',
};

export function getProfile(): Profile {
  return {
    userName: localStorage.getItem(KEYS.userName) || DEFAULTS.userName,
    userAvatar: localStorage.getItem(KEYS.userAvatar) || DEFAULTS.userAvatar,
    claudeName: localStorage.getItem(KEYS.claudeName) || DEFAULTS.claudeName,
    claudeAvatar: localStorage.getItem(KEYS.claudeAvatar) || DEFAULTS.claudeAvatar,
  };
}

export function saveProfile(p: Profile) {
  localStorage.setItem(KEYS.userName, p.userName);
  localStorage.setItem(KEYS.userAvatar, p.userAvatar);
  localStorage.setItem(KEYS.claudeName, p.claudeName);
  localStorage.setItem(KEYS.claudeAvatar, p.claudeAvatar);
}

/** React hook — re-renders when profile changes */
export function useProfile(): Profile {
  const [profile, setProfile] = useState(getProfile);
  useEffect(() => {
    const handler = () => setProfile(getProfile());
    window.addEventListener('profile-changed', handler);
    return () => window.removeEventListener('profile-changed', handler);
  }, []);
  return profile;
}

export function notifyProfileChanged() {
  window.dispatchEvent(new Event('profile-changed'));
}

/** Read an image file, resize to max, return data URL */
export function readAvatarFile(file: File, maxPx = 96): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('image load failed'));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
