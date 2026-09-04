import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../theme/colors';
import apiClient from '../services/api/apiClient';

type Notification = {
  id: number;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
};

const getNotifColor = (type: string) => {
  switch (type) {
    case 'signal': return COLORS.green;
    case 'alert': return COLORS.red;
    case 'warning': return COLORS.yellow;
    default: return COLORS.blue;
  }
};

const getNotifIcon = (type: string) => {
  switch (type) {
    case 'signal': return 'star-four-points';
    case 'alert': return 'alert-circle';
    case 'warning': return 'alert';
    default: return 'information-circle';
  }
};

export default function NotificationsPanel({ visible, onClose }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/notifications');
      setNotifications(data);
    } catch (e) {
      // silent fail
    }
  }, []);

  useEffect(() => {
    if (visible) fetchNotifications();
  }, [visible, fetchNotifications]);

  useEffect(() => {
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const deleteNotification = useCallback(async (id: number) => {
    try {
      await apiClient.delete(`/notifications/${id}`);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (e) {
      // silent fail
    }
  }, []);

  const clearAll = useCallback(async () => {
    try {
      await apiClient.delete('/notifications');
      setNotifications([]);
    } catch (e) {
      // silent fail
    }
  }, []);

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose}>
        <Pressable
          style={{
            position: 'absolute',
            top: 60,
            right: 16,
            left: 16,
            maxHeight: '60%',
            backgroundColor: COLORS.cardBg,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: COLORS.subtleBorder,
            overflow: 'hidden',
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
          }}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.subtleBorder }}>
            <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 }}>Notifications</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {notifications.length > 0 && (
                <TouchableOpacity onPress={clearAll} style={{ marginRight: 12 }}>
                  <Text style={{ color: COLORS.red, fontSize: 12, fontWeight: '600' }}>Clear All</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={20} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* List */}
          {notifications.length === 0 ? (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Ionicons name="notifications-off-outline" size={32} color={COLORS.textMuted} />
              <Text style={{ color: COLORS.textMuted, fontSize: 13, marginTop: 8 }}>No notifications</Text>
            </View>
          ) : (
            notifications.map((notif) => (
              <TouchableOpacity
                key={notif.id}
                onLongPress={() => deleteNotification(notif.id)}
                style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderBottomWidth: 1, borderBottomColor: COLORS.subtleBorder }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: getNotifColor(notif.type) + '20', justifyContent: 'center', alignItems: 'center', marginRight: 10, marginTop: 2 }}>
                  <MaterialCommunityIcons name={getNotifIcon(notif.type) as any} size={16} color={getNotifColor(notif.type)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.textPrimary, fontSize: 13, fontWeight: '600' }}>{notif.title}</Text>
                  <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 2 }}>{notif.message}</Text>
                  <Text style={{ color: COLORS.textMuted, fontSize: 10, marginTop: 4 }}>{notif.created_at}</Text>
                </View>
                <TouchableOpacity onPress={() => deleteNotification(notif.id)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={16} color={COLORS.textMuted} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
