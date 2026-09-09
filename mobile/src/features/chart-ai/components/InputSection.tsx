import React from 'react';
import { StyleSheet, TouchableOpacity, Alert, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../../theme/colors';

interface Props {
  onImageSelected: (uri: string, base64: string | null, mimeType: string) => void;
}

export default function InputSection({ onImageSelected }: Props) {
  const pickFromGallery = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please grant photo library access to upload chart images.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.5,
        base64: true,
        allowsEditing: true,
      });
      if (!res.canceled && res.assets[0]) {
        const asset = res.assets[0];
        const base64 = asset.base64 ?? null;
        if (!base64 || base64.length > 800_000) {
          Alert.alert('Image too large', 'Please pick a smaller image or screenshot.');
          return;
        }
        const mimeType = asset.uri.toLowerCase().endsWith('.png') ? 'image/png'
          : asset.uri.toLowerCase().endsWith('.webp') ? 'image/webp'
          : 'image/jpeg';
        onImageSelected(asset.uri, base64, mimeType);
      }
    } catch {
      Alert.alert('Unavailable', 'Image picker is not available on this device.');
    }
  };

  return (
    <TouchableOpacity style={styles.galleryBtn} activeOpacity={0.85} onPress={pickFromGallery}>
      <MaterialCommunityIcons name="image-multiple" size={20} color={COLORS.purple} />
      <Text style={styles.label}>Upload Chart Image</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  galleryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.purple + '12',
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(117,87,247,0.45)',
    marginBottom: 12,
  },
  label: {
    color: COLORS.purple,
    fontSize: 14,
    fontWeight: '700',
  },
});
