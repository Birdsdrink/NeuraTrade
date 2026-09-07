import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../../theme/colors';

interface Props {
  onImageSelected: (uri: string, base64: string | null) => void;
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
        quality: 0.85,
        base64: true,
      });
      if (!res.canceled && res.assets[0]) {
        onImageSelected(res.assets[0].uri, res.assets[0].base64 ?? null);
      }
    } catch {
      Alert.alert('Unavailable', 'Image picker is not available on this device.');
    }
  };

  const snapFromCamera = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please grant camera access to photograph charts.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        quality: 0.85,
        base64: true,
      });
      if (!res.canceled && res.assets[0]) {
        onImageSelected(res.assets[0].uri, res.assets[0].base64 ?? null);
      }
    } catch {
      Alert.alert('Unavailable', 'Camera is not available on this device.');
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.iconRing}>
        <MaterialCommunityIcons name="chart-line" size={40} color={COLORS.purple} />
        <View style={styles.sparkBadge}>
          <MaterialCommunityIcons name="star-four-points-outline" size={13} color={COLORS.yellow} />
        </View>
      </View>
      <Text style={styles.heading}>AI Chart Analysis</Text>
      <Text style={styles.sub}>
        Upload or snap a screenshot of any chart and let the AI read structure, momentum and
        liquidity for you.
      </Text>

      <TouchableOpacity style={styles.cameraBtn} activeOpacity={0.85} onPress={snapFromCamera}>
        <MaterialCommunityIcons name="camera" size={20} color="#fff" />
        <Text style={styles.cameraBtnText}>Snap Camera</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.galleryBtn} activeOpacity={0.85} onPress={pickFromGallery}>
        <MaterialCommunityIcons name="image-multiple" size={20} color={COLORS.purple} />
        <Text style={styles.galleryBtnText}>Upload Gallery</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.subtleBorder,
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 22,
    marginBottom: 16,
  },
  iconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(117,87,247,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(117,87,247,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.elevatedCard,
    borderWidth: 1,
    borderColor: COLORS.subtleBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 16,
  },
  sub: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
  },
  cameraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.purple,
    borderRadius: 14,
    paddingVertical: 13,
    alignSelf: 'stretch',
  },
  cameraBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  galleryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingVertical: 13,
    alignSelf: 'stretch',
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(117,87,247,0.5)',
  },
  galleryBtnText: {
    color: COLORS.purple,
    fontSize: 14,
    fontWeight: '700',
  },
});
