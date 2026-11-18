import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';

export default function App() {
  const dark = useColorScheme() === 'dark';
  const textColor = dark ? '#eceef1' : '#1a1d21';
  const mutedColor = dark ? '#a5adb6' : '#555d66';

  return (
    <View style={[styles.container, { backgroundColor: dark ? '#121417' : '#ffffff' }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: textColor }]}>
        ICON INFOSYS SERVICE MANAGEMENT
      </Text>
      <Text style={{ color: textColor }}>Customer app</Text>
      <Text style={[styles.note, { color: mutedColor }]}>
        Foundation build. Sign-in and service requests will be added in later phases.
      </Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  note: {
    textAlign: 'center',
  },
});
