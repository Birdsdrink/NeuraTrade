import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import COLORS from '../theme/colors';
import NotificationsPanel from './NotificationsPanel';
import apiClient from '../services/api/apiClient';

type Props = {
  title?: string;
  subtitle?: string;
  onClose?: () => void;
  showNotification?: boolean;
  showBrand?: boolean;
};

export default function AppHeader({ title, subtitle, onClose, showNotification = true, showBrand = true }: Props) {
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/notifications');
      setUnreadCount(Array.isArray(data) ? data.filter((n: any) => !n.read).length : 0);
    } catch (e) {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {showBrand && (
            <Image
              source={require('../../assets/icon.png')}
              style={{ width: 48, height: 48, marginRight: 10 }}
            />
          )}
          <View>
            {showBrand ? (
              <Text style={{ fontSize: 22, fontWeight: '800' }}>
                <Text style={{ color: COLORS.blue }}>Neura</Text>
                <Text style={{ color: COLORS.green }}>Trade</Text>
              </Text>
            ) : null}
            {subtitle ? <Text style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>{subtitle}</Text> : null}
            {!showBrand && title ? <Text style={{ fontSize: 24, fontWeight: 'bold', color: COLORS.textPrimary }}>{title}</Text> : null}
          </View>
        </View>
        {onClose ? (
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>
        ) : showNotification ? (
          <TouchableOpacity
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.cardBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.subtleBorder }}
            onPress={() => setShowNotifPanel(true)}
          >
            <Ionicons name="notifications-outline" size={20} color={COLORS.textPrimary} />
            {unreadCount > 0 && (
              <View style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.purple }} />
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      <NotificationsPanel visible={showNotifPanel} onClose={() => { setShowNotifPanel(false); fetchCount(); }} />
    </View>
  );
}
