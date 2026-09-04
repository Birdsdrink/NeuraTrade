declare module 'expo-image-picker' {
  export enum MediaTypeOptions {
    All = 'All',
    Images = 'Images',
    Videos = 'Videos',
  }

  export type ImagePickerResult = {
    canceled: boolean;
    assets: Array<{
      uri: string;
      base64?: string | null;
      width?: number;
      height?: number;
      type?: string;
    }>;
  };

  export type ImagePickerOptions = {
    mediaTypes?: MediaTypeOptions;
    allowsEditing?: boolean;
    quality?: number;
    base64?: boolean;
  };

  export function requestMediaLibraryPermissionsAsync(): Promise<{ granted: boolean }>;
  export function requestCameraPermissionsAsync(): Promise<{ granted: boolean }>;
  export function launchImageLibraryAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
  export function launchCameraAsync(options?: ImagePickerOptions): Promise<ImagePickerResult>;
}
