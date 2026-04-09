import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, FlatList, Keyboard, KeyboardAvoidingView, Linking, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

// データ読み込み
// data.js (または data.ts) が同じフォルダにある前提です
import { Word, wordList } from './data';

const LEVELS = ['400','500','600', '700', '800'];
const ITEMS_PER_SET = 30;
const SCREEN_WIDTH = Dimensions.get('window').width;

const Stack = createNativeStackNavigator();

// --- ヘルパー関数 ---
const getWordsData = async (targetLevel: string): Promise<Word[]> => {
  if (targetLevel === 'CUSTOM') {
    try {
      const json = await AsyncStorage.getItem('USER_CUSTOM_WORDS');
      return json ? JSON.parse(json) : [];
    } catch (e) { return []; }
  } else {
    return wordList.filter(w => String(w.level) === targetLevel);
  }
};

const getRank = (totalCompletedSets: number) => {
  if (totalCompletedSets >= 50) return { title: 'TOEIC神 👑', color: '#f1c40f' };
  if (totalCompletedSets >= 30) return { title: 'マスター 🎓', color: '#9b59b6' };
  if (totalCompletedSets >= 15) return { title: 'エキスパート 🏅', color: '#e74c3c' };
  if (totalCompletedSets >= 5) return { title: 'ルーキー 🌿', color: '#2ecc71' };
  return { title: 'たまご 🥚', color: '#bdc3c7' };
};

const ProgressBar = ({ progress }: { progress: number }) => {
  return (
    <View style={styles.progressBarContainer}>
      <View style={[styles.progressBarFill, { width: `${Math.min(progress, 100)}%` }]} />
    </View>
  );
};

// --- シャッフル関数 ---
const shuffleArray = (array: any[]) => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

// --- 共通: ローディング表示 ---
const LoadingView = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#3498db" />
    <Text style={styles.loadingText}>Loading...</Text>
  </View>
);

// --- 画面: チュートリアル ---
function TutorialScreen({ navigation }: { navigation: any }) {
  const [page, setPage] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);

  const slides = [
    { title: "TOEIC マスターへようこそ！", content: "効率的にスコアアップを目指すための\n最強の単語学習アプリです。", icon: "🎉", color: "#3498db" },
    { title: "⚠️ 過去ミス (History)", content: "テストで一度でも間違えた単語は\n自動で「⚠️履歴」に残ります。\n手動で消すまで残り続けます。", icon: "⚠️", color: "#e67e22" },
    { title: "★ 苦手 (Star)", content: "今、覚えていない単語は「★」がつきます。\n「★克服テスト」で正解すると\n自動的に消えていきます！", icon: "★", color: "#f1c40f" },
    { title: "完走型テスト", content: "間違えた問題は、正解するまで\n何度でも再出題されます。\n逃げずに最後までやりきりましょう！", icon: "🔥", color: "#e74c3c" }
  ];

  const handleNext = async () => {
    if (page < slides.length - 1) {
      setPage(page + 1);
      scrollViewRef.current?.scrollTo({ x: SCREEN_WIDTH * (page + 1), animated: true });
    } else {
      await AsyncStorage.setItem('HAS_SEEN_TUTORIAL', 'true');
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.safeContainer}>
      <View style={styles.container}>
        <ScrollView ref={scrollViewRef} horizontal pagingEnabled scrollEnabled={false} showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          {slides.map((slide, index) => (
            <View key={index} style={[styles.slideContainer, { width: SCREEN_WIDTH }]}>
              <View style={[styles.slideCard, { borderColor: slide.color }]}>
                <Text style={styles.slideIcon}>{slide.icon}</Text>
                <Text style={[styles.slideTitle, { color: slide.color }]}>{slide.title}</Text>
                <Text style={styles.slideContent}>{slide.content}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={styles.pagination}>
          {slides.map((_, i) => <View key={i} style={[styles.dot, i === page && styles.dotActive]} />)}
        </View>
        <TouchableOpacity style={styles.tutorialButton} onPress={handleNext}>
          <Text style={styles.tutorialButtonText}>{page === slides.length - 1 ? "学習を始める！" : "次へ ➡"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// --- 画面: 設定 ---
function SettingsScreen({ navigation }: { navigation: any }) {
  const handleResetProgress = () => {
    Alert.alert("進捗のリセット", "学習の記録（周回数や連続日数）を0に戻しますか？\n※★や⚠️、My単語帳は消えません。", [
      { text: "キャンセル", style: "cancel" },
      { text: "リセットする", style: "destructive", onPress: async () => {
          try {
            await AsyncStorage.removeItem('STUDY_PROGRESS');
            await AsyncStorage.removeItem('CURRENT_STREAK');
            await AsyncStorage.removeItem('LAST_LOGIN_DATE');
            Alert.alert("完了", "進捗データをリセットしました。");
          } catch (e) { Alert.alert("エラー", "失敗しました。"); }
      }}
    ]);
  };

  const handleAllClear = () => {
    Alert.alert("⚠️ アプリの完全初期化", "全てのデータを消去して初期状態に戻します。\n本当によろしいですか？", [
      { text: "キャンセル", style: "cancel" },
      { text: "全て消去して再起動", style: "destructive", onPress: async () => {
          try {
            await AsyncStorage.clear();
            Alert.alert("完了", "初期化しました。", [{ text: "OK", onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] }) }]);
          } catch (e) { Alert.alert("エラー", "失敗しました。"); }
      }}
    ]);
  };

  const openFeedback = () => {
    // 指定されたGoogleフォームのURL
    Linking.openURL('https://docs.google.com/forms/d/e/1FAIpQLSfyB-oMeWabP2AzILmfhAbconlyj0L2eRWVLvOPeLwa1IzP6w/viewform?usp=header'); 
  };

  return (
    <View style={styles.listBackground}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={styles.headerTitle}>設定・サポート</Text>
        <View style={styles.settingSection}>
          <Text style={styles.sectionHeader}>サポート</Text>
          <TouchableOpacity style={styles.settingButton} onPress={() => navigation.navigate('Tutorial')}>
            <Text style={styles.settingButtonText}>🔰 チュートリアルを見る</Text>
            <Text style={styles.settingSubText}>アプリの使い方やルールの確認</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.settingButton, {borderBottomWidth: 0}]} onPress={openFeedback}>
            <Text style={styles.settingButtonText}>📩 お問い合わせ・要望</Text>
            <Text style={styles.settingSubText}>開発者にメッセージを送る</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.settingSection}>
          <Text style={styles.sectionHeader}>データ管理</Text>
          <TouchableOpacity style={styles.settingButton} onPress={handleResetProgress}>
            <View><Text style={styles.settingButtonText}>📊 学習進捗のリセット</Text><Text style={styles.settingSubText}>周回数と連続日数を0に戻します</Text></View>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.settingButton, {borderBottomWidth: 0}]} onPress={handleAllClear}>
            <View><Text style={[styles.settingButtonText, {color: '#e74c3c'}]}>🗑️ アプリの完全初期化</Text><Text style={styles.settingSubText}>★も履歴も全て消去されます</Text></View>
          </TouchableOpacity>
        </View>
        <View style={styles.settingSection}>
          <Text style={styles.sectionHeader}>アプリについて</Text>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>バージョン</Text><Text style={styles.infoValue}>1.0.0</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>開発者</Text><Text style={styles.infoValue}>KJ</Text></View>
        </View>
        <Text style={{textAlign:'center', color:'#bdc3c7', marginTop: 20}}>© 2025 TOEIC Master by KJ</Text>
      </ScrollView>
    </View>
  );
}

// --- 画面: ホーム ---
function HomeScreen({ navigation }: { navigation: any }) {
  const [streak, setStreak] = useState(0);
  const [totalSetsDone, setTotalSetsDone] = useState(0);
  const [rank, setRank] = useState({ title: '...', color: '#ccc' });

  useEffect(() => {
    const checkFirstLaunch = async () => {
      const hasSeen = await AsyncStorage.getItem('HAS_SEEN_TUTORIAL');
      if (hasSeen !== 'true') navigation.navigate('Tutorial');
    };
    checkFirstLaunch();
  }, []);

  useFocusEffect(
    useCallback(() => {
      const loadStats = async () => {
        try {
          const today = new Date().toDateString();
          const lastLogin = await AsyncStorage.getItem('LAST_LOGIN_DATE');
          const currentStreakStr = await AsyncStorage.getItem('CURRENT_STREAK');
          let currentStreak = currentStreakStr ? parseInt(currentStreakStr) : 0;

          if (lastLogin !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            if (lastLogin === yesterday.toDateString()) currentStreak += 1;
            else currentStreak = 1;
            await AsyncStorage.setItem('LAST_LOGIN_DATE', today);
            await AsyncStorage.setItem('CURRENT_STREAK', currentStreak.toString());
          }
          setStreak(currentStreak);

          const storedProgress = await AsyncStorage.getItem('STUDY_PROGRESS');
          if (storedProgress) {
            const progress = JSON.parse(storedProgress);
            const count = Object.values(progress).filter((v: any) => v > 0).length;
            setTotalSetsDone(count);
            setRank(getRank(count));
          }
        } catch (e) {}
      };
      loadStats();
    }, [])
  );

  return (
    <SafeAreaView style={styles.safeContainer}>
      <View style={styles.container}>
        <View style={styles.dashboard}>
          <View style={styles.dashboardHeaderRow}>
            <Text style={styles.appTitleWhite}>TOEIC マスター</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.settingsIcon}>
              <Text style={{fontSize: 24}}>⚙️</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>🔥 連続日数</Text>
              <Text style={styles.statValue}>{streak}日</Text>
            </View>
            <View style={[styles.statBox, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }]}>
              <Text style={styles.statLabel}>🏆 現在のランク</Text>
              <Text style={[styles.statValue, { color: rank.color, textShadowColor:'rgba(0,0,0,0.2)', textShadowRadius:2 }]}>{rank.title}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>📚 完了セット</Text>
              <Text style={styles.statValue}>{totalSetsDone}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.subHeader}>学習するレベルを選んでください</Text>
        
        <ScrollView style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 50 }}>
          {LEVELS.map((level) => {
            const levelCount = wordList.filter(w => String(w.level) === level).length;
            if (levelCount === 0) return null;
            return (
              <TouchableOpacity key={level} style={styles.levelCard} onPress={() => navigation.navigate('LevelDetail', { targetLevel: level })} activeOpacity={0.8}>
                <View><Text style={styles.levelCardTitle}>Level {level}</Text><Text style={styles.levelCardSubtitle}>全{levelCount}語</Text></View>
                <View style={styles.iconCircle}><Text style={styles.arrowIcon}>➡</Text></View>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={[styles.levelCard, styles.myWordCard]} onPress={() => navigation.navigate('MyWord')} activeOpacity={0.8}>
            <View><Text style={styles.levelCardTitle}>＋ My単語帳</Text><Text style={styles.levelCardSubtitle}>自分で単語を追加・編集</Text></View>
            <View style={[styles.iconCircle, {backgroundColor: '#eafaf1'}]}><Text style={styles.arrowIcon}>✏️</Text></View>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// --- 画面: レベル詳細 ---
function LevelDetailScreen({ route, navigation }: { route: any, navigation: any }) {
  const { targetLevel } = route.params;
  const [progressData, setProgressData] = useState<{[key: string]: number}>({});
  const levelWords = useMemo(() => wordList.filter(w => String(w.level) === targetLevel), [targetLevel]);
  const setTotal = Math.ceil(levelWords.length / ITEMS_PER_SET);

  useFocusEffect(useCallback(() => {
      const load = async () => {
        try { const stored = await AsyncStorage.getItem('STUDY_PROGRESS'); if (stored) setProgressData(JSON.parse(stored)); } catch (e) {}
      }; load();
    }, [])
  );

  const handleStudyPress = (setNum: number) => {
    Alert.alert("学習モード選択", "リストで一気見学習します", [
        { text: "全ての単語", onPress: () => navigation.navigate('Study', { targetLevel, setNumber: setNum, mode: 'ALL' }) },
        { text: "⚠️ 過去の間違い (History)", onPress: () => navigation.navigate('Study', { targetLevel, setNumber: setNum, mode: 'HISTORY' }) },
        { text: "キャンセル", style: "cancel" }
    ]);
  };
  const handleTestPress = (setNum: number) => {
    Alert.alert("テスト形式を選択", "どちらの問題を解きますか？", [
        { text: "完走チャレンジ (全問)", onPress: () => navigation.navigate('Test', { targetLevel, setNumber: setNum, mode: 'ALL' }) },
        { text: "★ 克服テスト (正解で★消去)", onPress: () => navigation.navigate('Test', { targetLevel, setNumber: setNum, mode: 'STAR' }) },
        { text: "キャンセル", style: "cancel" }
    ]);
  };
  const startSpecialTest = (mode: 'RANDOM50' | 'HISTORY50') => navigation.navigate('Test', { targetLevel, mode });

  return (
    <View style={styles.container}>
      <Text style={styles.headerTitle}>Level {targetLevel} コース</Text>
      <ScrollView style={{ width: '100%' }} contentContainerStyle={{ alignItems: 'center', paddingBottom: 50 }}>
        <View style={styles.specialTestSection}>
          <Text style={styles.sectionHeader}>🏆 総合テスト</Text>
          <View style={styles.specialButtonGroup}>
            <TouchableOpacity style={[styles.specialButton, {backgroundColor: '#8e44ad'}]} onPress={() => startSpecialTest('RANDOM50')}>
              <Text style={styles.specialButtonText}>🎲 ランダム50</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.specialButton, {backgroundColor: '#e67e22'}]} onPress={() => startSpecialTest('HISTORY50')}>
              <Text style={styles.specialButtonText}>⚠️ 過去ミス50</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={[styles.sectionHeader, {marginTop: 20}]}>📚 セット別学習</Text>
        {Array.from({ length: setTotal }).map((_, i) => {
          const setNum = i + 1;
          const start = (setNum - 1) * ITEMS_PER_SET + 1;
          const end = Math.min(setNum * ITEMS_PER_SET, levelWords.length);
          const lapCount = progressData[`${targetLevel}_${setNum}`] || 0;
          return (
            <View key={setNum} style={[styles.setRow, lapCount > 0 && styles.setRowCompleted]}>
              <View style={styles.setInfo}>
                <View style={{flexDirection:'row', justifyContent:'space-between'}}><Text style={styles.setLabel}>Set {setNum}</Text><Text style={styles.setRange}>({start}~{end})</Text></View>
                <ProgressBar progress={lapCount > 0 ? 100 : 0} />
                <Text style={styles.badgeText}>{lapCount === 0 ? '未完了' : `✅ ${lapCount}周完了`}</Text>
              </View>
              <View style={styles.buttonGroup}>
                <TouchableOpacity style={[styles.menuButton, styles.smallButton]} onPress={() => handleStudyPress(setNum)}><Text style={styles.menuButtonText}>📖 学習</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.menuButton, styles.secondaryButton, styles.smallButton]} onPress={() => handleTestPress(setNum)}><Text style={styles.menuButtonText}>📝 テスト</Text></TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// MyWordScreen
function MyWordScreen({ navigation }: { navigation: any }) {
  const [customWords, setCustomWords] = useState<Word[]>([]);
  const [enText, setEnText] = useState('');
  const [jpText, setJpText] = useState('');

  useFocusEffect(useCallback(() => {
      const load = async () => { const json = await AsyncStorage.getItem('USER_CUSTOM_WORDS'); if (json) setCustomWords(JSON.parse(json)); }; load();
    }, [])
  );

  const handleAddWord = async () => {
    if (!enText.trim() || !jpText.trim()) return Alert.alert("エラー", "英語と日本語を入力してください。");
    const newWord: Word = { id: Date.now(), en: enText.trim(), jp: jpText.trim(), level: 'CUSTOM' };
    const newList = [...customWords, newWord];
    setCustomWords(newList);
    await AsyncStorage.setItem('USER_CUSTOM_WORDS', JSON.stringify(newList));
    setEnText(''); setJpText(''); Keyboard.dismiss();
    Alert.alert("登録完了", `「${newWord.en}」を追加しました！`);
  };
  const handleDeleteWord = async (id: number) => {
    Alert.alert("削除確認", "削除しますか？", [{ text: "キャンセル", style: "cancel" }, { text: "削除", style: "destructive", onPress: async () => {
          const newList = customWords.filter(w => w.id !== id); setCustomWords(newList); await AsyncStorage.setItem('USER_CUSTOM_WORDS', JSON.stringify(newList));
        }}]);
  };
  const handleStudyPress = () => {
    if (customWords.length === 0) return Alert.alert("データなし", "単語を登録してください。");
    navigation.navigate('Study', { targetLevel: 'CUSTOM', setNumber: 1, mode: 'ALL' });
  };
  const handleTestPress = () => {
    if (customWords.length < 4) return Alert.alert("単語不足", "テストには最低4単語必要です。");
    navigation.navigate('Test', { targetLevel: 'CUSTOM', setNumber: 1, mode: 'ALL' });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.container}>
      <View style={styles.inputSection}>
        <Text style={styles.inputHeader}>新しい単語を登録</Text>
        <View style={styles.inputWrapper}><Text style={styles.inputLabel}>英語</Text><TextInput style={styles.input} placeholder="例: apple" placeholderTextColor="#bdc3c7" value={enText} onChangeText={setEnText} autoCapitalize="none" /></View>
        <View style={styles.inputWrapper}><Text style={styles.inputLabel}>日本語</Text><TextInput style={styles.input} placeholder="例: リンゴ" placeholderTextColor="#bdc3c7" value={jpText} onChangeText={setJpText} /></View>
        <TouchableOpacity style={styles.addButton} onPress={handleAddWord}><Text style={styles.addButtonText}>＋ リストに追加</Text></TouchableOpacity>
      </View>
      <View style={styles.actionSection}>
        <View style={{flexDirection: 'row', justifyContent:'space-between', alignItems:'center', marginBottom:10}}><Text style={styles.listHeader}>登録済み単語 ({customWords.length})</Text></View>
        <View style={styles.buttonGroup}>
          <TouchableOpacity style={[styles.menuButton, styles.smallButton]} onPress={handleStudyPress}><Text style={styles.menuButtonText}>📖 学習する</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.menuButton, styles.secondaryButton, styles.smallButton]} onPress={handleTestPress}><Text style={styles.menuButtonText}>📝 テストする</Text></TouchableOpacity>
        </View>
      </View>
      <FlatList data={customWords} keyExtractor={item => item.id.toString()} style={{ width: '90%', flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}
        renderItem={({ item }) => (
          <View style={styles.myWordItem}>
            <View style={{flex: 1}}><Text style={styles.myWordEn}>{item.en}</Text><Text style={styles.myWordJp}>{item.jp}</Text></View>
            <TouchableOpacity onPress={() => handleDeleteWord(item.id)} style={styles.deleteButton}><Text style={styles.deleteText}>🗑️</Text></TouchableOpacity>
          </View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

// WordListItem
const WordListItem = ({ item, isStarred, isHistory, onToggleStar, onToggleHistory }: any) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[styles.listItem, (isStarred || isHistory) && styles.listItemHighlighted]}>
      <TouchableOpacity style={styles.listItemContent} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
        <View style={styles.listHeaderRow}>
          <Text style={styles.listEnglish}>{item.en}</Text>
          <TouchableOpacity onPress={() => Speech.speak(item.en, { language: 'en' })} style={styles.listSpeaker}><Text>🔊</Text></TouchableOpacity>
        </View>
        {expanded ? <View style={styles.listAnswerContainer}><Text style={styles.listJapanese}>{item.jp}</Text></View> : <Text style={styles.listHint}>タップで意味を表示</Text>}
      </TouchableOpacity>
      <View style={styles.listActions}>
        <TouchableOpacity onPress={() => onToggleStar(item.id)} style={styles.iconTouch}><Text style={[styles.actionIcon, isStarred ? {color: '#f1c40f'} : {color: '#ddd'}]}>★</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => onToggleHistory(item.id)} style={styles.iconTouch}><Text style={[styles.actionIcon, isHistory ? {color: '#e67e22'} : {color: '#ddd'}]}>⚠️</Text></TouchableOpacity>
      </View>
    </View>
  );
};

// StudyScreen
function StudyScreen({ route, navigation }: { route: any, navigation: any }) {
  const { targetLevel, setNumber, mode } = route.params;
  const [starIds, setStarIds] = useState<number[]>([]);
  const [historyIds, setHistoryIds] = useState<number[]>([]);
  const [targetWords, setTargetWords] = useState<Word[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const initData = async () => {
      const s = await AsyncStorage.getItem('STARRED_WORDS');
      const h = await AsyncStorage.getItem('HISTORY_WORDS');
      setStarIds(s ? JSON.parse(s) : []);
      setHistoryIds(h ? JSON.parse(h) : []);
      const allWords = await getWordsData(targetLevel);
      let words: Word[] = [];
      if (targetLevel === 'CUSTOM') words = allWords;
      else {
        const start = (setNumber - 1) * ITEMS_PER_SET;
        const end = start + ITEMS_PER_SET;
        words = allWords.slice(start, end);
      }
      if (mode === 'HISTORY') words = words.filter(w => (h ? JSON.parse(h) : []).includes(w.id));
      setTargetWords(words);
      setIsLoaded(true);
    };
    initData();
  }, []);

  const toggleStar = async (id: number) => {
    let newIds = starIds.includes(id) ? starIds.filter(sid => sid !== id) : [...starIds, id];
    setStarIds(newIds);
    await AsyncStorage.setItem('STARRED_WORDS', JSON.stringify(newIds));
  };
  const toggleHistory = async (id: number) => {
    let newIds = historyIds.includes(id) ? historyIds.filter(hid => hid !== id) : [...historyIds, id];
    setHistoryIds(newIds);
    await AsyncStorage.setItem('HISTORY_WORDS', JSON.stringify(newIds));
  };

  if (!isLoaded) return <LoadingView />;
  if (targetWords.length === 0) return (
    <View style={styles.container}>
      <Text style={styles.subTitle}>対象データなし</Text>
      <TouchableOpacity style={[styles.menuButton, {marginTop:20}]} onPress={() => navigation.goBack()}><Text style={styles.menuButtonText}>戻る</Text></TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.containerList}>
      <View style={styles.listPageHeader}><Text style={styles.headerTitle}>{mode === 'HISTORY' ? '復習リスト(⚠️)' : '単語一覧'} ({targetWords.length}語)</Text></View>
      <FlatList data={targetWords} keyExtractor={item => item.id.toString()} contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: 15 }}
        renderItem={({ item }) => <WordListItem item={item} isStarred={starIds.includes(item.id)} isHistory={historyIds.includes(item.id)} onToggleStar={toggleStar} onToggleHistory={toggleHistory} />}
      />
      <View style={styles.floatingFooter}>
        <TouchableOpacity style={styles.finishButtonList} onPress={() => navigation.goBack()}><Text style={styles.finishButtonText}>学習完了！メニューへ</Text></TouchableOpacity>
      </View>
    </View>
  );
}

// TestScreen
function TestScreen({ navigation, route }: { navigation: any, route: any }) {
  const { targetLevel, setNumber, mode } = route.params;
  const [queue, setQueue] = useState<Word[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [starIds, setStarIds] = useState<number[]>([]);
  const [historyIds, setHistoryIds] = useState<number[]>([]);
  const [selectedChoiceId, setSelectedChoiceId] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [allWordsPool, setAllWordsPool] = useState<Word[]>([]);
  const [answerStatus, setAnswerStatus] = useState<'correct' | 'wrong' | null>(null);

  useEffect(() => {
    const initTest = async () => {
      const s = await AsyncStorage.getItem('STARRED_WORDS');
      const h = await AsyncStorage.getItem('HISTORY_WORDS');
      const sIds = s ? JSON.parse(s) : [];
      const hIds = h ? JSON.parse(h) : [];
      setStarIds(sIds); setHistoryIds(hIds);

      const allWords = await getWordsData(targetLevel);
      setAllWordsPool(allWords);
      let targetWords: Word[] = [];

      if (mode === 'RANDOM50') targetWords = shuffleArray(allWords).slice(0, 50);
      else if (mode === 'HISTORY50') targetWords = shuffleArray(allWords.filter(w => hIds.includes(w.id))).slice(0, 50);
      else if (targetLevel === 'CUSTOM') targetWords = mode === 'STAR' ? allWords.filter(w => sIds.includes(w.id)) : allWords;
      else {
        const start = (setNumber - 1) * ITEMS_PER_SET;
        const end = start + ITEMS_PER_SET;
        let setWords = allWords.slice(start, end);
        if (mode === 'STAR') setWords = setWords.filter(w => sIds.includes(w.id));
        targetWords = setWords;
      }
      const shuffled = targetWords.sort(() => 0.5 - Math.random());
      setQueue(shuffled); setTotalCount(shuffled.length); setIsLoaded(true);
    };
    initTest();
  }, []);

  const currentWord = queue[0];
  const choices = useMemo(() => {
    if (!currentWord || allWordsPool.length === 0) return [];
    const distractors = allWordsPool.filter(w => w.id !== currentWord.id);
    if (distractors.length < 3) { 
       const fallback = wordList.slice(0, 10).filter(w => w.id !== currentWord.id); 
        return shuffleArray([...shuffleArray([...distractors, ...fallback]).slice(0, 3), currentWord]);
      }
    return shuffleArray([...shuffleArray(distractors).slice(0, 3), currentWord]);
  }, [currentWord, allWordsPool]);

  // ★ 修正済み: TypeScriptエラー対応 & 画面遷移時の音声停止
  useEffect(() => {
    if (currentWord) { 
      Speech.speak(currentWord.en, { language: 'en' }); 
      setAnswerStatus(null); 
      setSelectedChoiceId(null); 
      setIsProcessing(false); 
    }
    return () => { Speech.stop(); };
  }, [currentWord]);

 const handleFinish = async () => {
    if (mode === 'ALL' && targetLevel !== 'CUSTOM') {
      try {
        const key = `${targetLevel}_${setNumber}`;
        const stored = await AsyncStorage.getItem('STUDY_PROGRESS');
        const progress = stored ? JSON.parse(stored) : {};
        progress[key] = (progress[key] || 0) + 1;
        await AsyncStorage.setItem('STUDY_PROGRESS', JSON.stringify(progress));
      } catch (e) {
        // エラー内容をコンソールに残し、ユーザーにも通知する
        console.error("[Data Save Error] 進捗の保存に失敗しました:", e);
        Alert.alert("警告", "端末の容量不足などの理由で、進捗が保存されなかった可能性があります。");
      }
    }
    Alert.alert("全問クリア！🎉", "お疲れ様でした！", [{ text: "戻る", onPress: () => navigation.goBack() }]);
  };

  const goNext = () => {
    setQueue(prev => prev.slice(1));
    if (queue.length === 1) handleFinish();
  };

  const handleAnswer = async (selectedWord: Word) => {
    if (answerStatus !== null) {
      if (answerStatus === 'wrong' && selectedWord.id === currentWord.id) goNext();
      return;
    }
    setSelectedChoiceId(selectedWord.id);
    const isCorrect = selectedWord.id === currentWord.id;
    let newStars = [...starIds];
    let newHistory = [...historyIds];

    if (isCorrect) {
      setAnswerStatus('correct');
      if (mode === 'STAR' && newStars.includes(currentWord.id)) {
        newStars = newStars.filter(id => id !== currentWord.id);
        setStarIds(newStars);
        await AsyncStorage.setItem('STARRED_WORDS', JSON.stringify(newStars));
      }
      setTimeout(() => { goNext(); }, 300);
    } else {
      setAnswerStatus('wrong');
      let updated = false;
      if (!newStars.includes(currentWord.id)) { newStars.push(currentWord.id); setStarIds(newStars); await AsyncStorage.setItem('STARRED_WORDS', JSON.stringify(newStars)); updated = true; }
      if (!newHistory.includes(currentWord.id)) { newHistory.push(currentWord.id); setHistoryIds(newHistory); await AsyncStorage.setItem('HISTORY_WORDS', JSON.stringify(newHistory)); updated = true; }
      setQueue(prev => [...prev, currentWord]);
    }
  };

  if (!isLoaded) return <LoadingView />;
  if (totalCount === 0) return <View style={styles.container}><Text>対象データがありません</Text><TouchableOpacity style={[styles.menuButton, {marginTop:20}]} onPress={() => navigation.goBack()}><Text style={styles.menuButtonText}>戻る</Text></TouchableOpacity></View>;
  if (!currentWord) return <View style={styles.container}><Text>クリア！</Text></View>;

  const isStarredCurrent = starIds.includes(currentWord.id);
  const isHistoryCurrent = historyIds.includes(currentWord.id);

  return (
    <View style={styles.container}>
      <View style={styles.testHeader}>
        <Text style={styles.headerTitle}>残り: {queue.length}問</Text>
        <View style={{flexDirection:'row'}}>
          {isHistoryCurrent && <Text style={{fontSize:20, marginRight:5}}>⚠️</Text>}
          {isStarredCurrent && <Text style={{color: '#f1c40f', fontSize:24}}>★</Text>}
        </View>
      </View>
      <View style={styles.questionCard}><Text style={styles.questionText}>{currentWord.en}</Text></View>
      <View style={styles.choicesContainer}>
        {choices.map((choice) => {
          let buttonStyle: any[] = [styles.choiceButton];
          let textStyle: any[] = [styles.choiceText];
          if (answerStatus === 'correct') {
            if (choice.id === currentWord.id) { buttonStyle.push(styles.choiceButtonCorrect); textStyle.push(styles.choiceTextWhite); }
          } else if (answerStatus === 'wrong') {
            if (choice.id === currentWord.id) { buttonStyle.push(styles.choiceButtonCorrect); textStyle.push(styles.choiceTextWhite); }
            else if (choice.id === selectedChoiceId) { buttonStyle.push(styles.choiceButtonWrong); textStyle.push(styles.choiceTextWhite); }
          }
          return (
            <TouchableOpacity key={choice.id} style={buttonStyle} onPress={() => handleAnswer(choice)} disabled={answerStatus === 'correct'} activeOpacity={0.8}>
              <Text style={textStyle}>{choice.jp}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {answerStatus === 'wrong' && (<Text style={{marginTop: 10, color: '#27ae60', fontWeight:'bold'}}>正解（緑）をタップして次へ ➡</Text>)}
    </View>
  );
}

// --- メイン構成 ---
export default function App() {
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'メニュー', headerShown: false }} />
      <Stack.Screen name="LevelDetail" component={LevelDetailScreen} options={{ title: 'セット選択' }} />
      <Stack.Screen name="MyWord" component={MyWordScreen} options={{ title: 'My単語帳' }} />
      <Stack.Screen name="Study" component={StudyScreen} options={{ title: '単語リスト学習' }} />
      <Stack.Screen name="Test" component={TestScreen} options={{ title: '実力テスト' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: '設定' }} />
      <Stack.Screen name="Tutorial" component={TutorialScreen} options={{ title: 'チュートリアル', headerShown: false }} />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  // 基本レイアウト
  safeContainer: { flex: 1, backgroundColor: '#f5f6fa' },
  container: { flex: 1, backgroundColor: '#f5f6fa', alignItems: 'center', justifyContent: 'center' },
  containerList: { flex: 1, backgroundColor: '#f5f6fa' },
  listBackground: { flex: 1, backgroundColor: '#f5f6fa' },

  // ローディング
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f6fa' },
  loadingText: { marginTop: 10, color: '#7f8c8d' },
  
  // ダッシュボード
  dashboard: { width: '100%', backgroundColor: '#3498db', paddingTop: Platform.OS === 'android' ? 40 : 20, paddingBottom: 20, marginBottom: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, alignItems: 'center', shadowColor: "#000", shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.2, elevation: 5 },
  dashboardHeaderRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', width: '100%', marginBottom: 15, position: 'relative' },
  settingsIcon: { position: 'absolute', right: 20, top: 2 },
  appTitleWhite: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  statsRow: { flexDirection: 'row', width: '90%', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 15, padding: 10, justifyContent: 'space-around' },
  statBox: { alignItems: 'center', flex: 1 },
  statLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginBottom: 5 },
  statValue: { color: '#fff', fontSize: 20, fontWeight: 'bold' },

  subHeader: { fontSize: 16, color: '#7f8c8d', marginBottom: 15, width:'90%', textAlign:'center' },
  subTitle: { fontSize: 20, color: '#7f8c8d', marginBottom: 20, fontWeight: 'bold', textAlign: 'center' },
  
  // レベルカード
  levelCard: { width: '90%', backgroundColor: '#fff', borderRadius: 15, padding: 20, marginBottom: 15, elevation: 3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 5 },
  levelCardTitle: { fontSize: 22, fontWeight: 'bold', color: '#2c3e50' },
  levelCardSubtitle: { fontSize: 13, color: '#95a5a6', marginTop: 3 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#f0f3f4', alignItems: 'center', justifyContent: 'center' },
  myWordCard: { borderLeftWidth: 5, borderLeftColor: '#27ae60' },
  arrowIcon: { fontSize: 20, color: '#bdc3c7' },

  // 進捗バー
  progressBarContainer: { height: 6, backgroundColor: '#eee', borderRadius: 3, marginTop: 8, width: '100%', overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#27ae60', borderRadius: 3 },
  badgeText: { fontSize: 11, color: '#27ae60', fontWeight:'bold', marginTop: 3 },

  // セット行
  setRow: { width: '90%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, backgroundColor: '#fff', padding: 15, borderRadius: 12, elevation: 1 },
  setRowCompleted: { backgroundColor: '#f9fff9', borderWidth: 1, borderColor: '#d5f5e3' },
  setInfo: { flexDirection:'column', width: '38%' },
  setLabel: { fontSize: 16, fontWeight: 'bold', color: '#34495e' },
  setRange: { fontSize: 11, color: '#95a5a6' },

  // 総合テストボタン
  specialTestSection: { width: '90%', marginBottom: 15, padding: 10 },
  sectionHeader: { fontSize: 16, fontWeight: 'bold', color: '#34495e', marginBottom: 10, marginLeft: 5 },
  specialButtonGroup: { flexDirection: 'row', justifyContent: 'space-between' },
  specialButton: { width: '48%', paddingVertical: 12, borderRadius: 10, alignItems: 'center', elevation: 2 },
  specialButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  specialButtonSubText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },

  buttonGroup: { flexDirection: 'row', width: '60%', justifyContent: 'space-between' },
  menuButton: { backgroundColor: '#3498db', paddingVertical: 8, borderRadius: 8, alignItems: 'center', width: '48%' },
  smallButton: { },
  secondaryButton: { backgroundColor: '#e67e22' },
  menuButtonText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },

  // 設定画面
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50', marginBottom: 15, textAlign: 'center', marginTop: 15 },
  settingSection: { backgroundColor: '#fff', borderRadius: 15, marginBottom: 25, overflow: 'hidden', elevation: 2 },
  settingButton: { padding: 18, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  settingButtonText: { fontSize: 16, fontWeight: 'bold', color: '#2c3e50' },
  settingSubText: { fontSize: 12, color: '#95a5a6', marginTop: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 18, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  infoLabel: { fontSize: 16, color: '#2c3e50' },
  infoValue: { fontSize: 16, color: '#7f8c8d' },

  // MyWordScreen
  inputSection: { width: '90%', backgroundColor: '#fff', padding: 20, borderRadius: 15, marginBottom: 20, elevation: 2 },
  inputHeader: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, color: '#34495e', textAlign: 'center' },
  inputWrapper: { marginBottom: 10 },
  inputLabel: { fontSize: 12, color: '#7f8c8d', marginBottom: 3, fontWeight: 'bold' },
  input: { backgroundColor: '#f9f9f9', borderWidth: 1, borderColor: '#eee', borderRadius: 8, padding: 10, fontSize: 16 },
  addButton: { backgroundColor: '#27ae60', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 5 },
  addButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  actionSection: { width: '90%', marginBottom: 15 },
  listHeader: { fontSize: 16, fontWeight: 'bold', color: '#7f8c8d' },
  myWordItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 10, elevation: 1 },
  myWordEn: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50' },
  myWordJp: { fontSize: 14, color: '#7f8c8d' },
  deleteButton: { padding: 10 },
  deleteText: { fontSize: 18 },

  // リストスタイル
  listPageHeader: { padding: 15, alignItems: 'center', backgroundColor: '#f5f6fa' },
  listItem: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 10, marginBottom: 10, elevation: 1, padding: 5, alignItems: 'flex-start' },
  listItemHighlighted: { backgroundColor: '#fffcf5', borderWidth: 1, borderColor: '#f1c40f' },
  listItemContent: { flex: 1, padding: 15 },
  listHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  listEnglish: { fontSize: 20, fontWeight: 'bold', color: '#2c3e50', marginRight: 10 },
  listSpeaker: { backgroundColor: '#eee', padding: 5, borderRadius: 15 },
  listAnswerContainer: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#eee' },
  listJapanese: { fontSize: 16, color: '#e74c3c', fontWeight: 'bold' },
  listHint: { fontSize: 12, color: '#bdc3c7', marginTop: 5 },
  listActions: { justifyContent: 'space-around', alignItems: 'center', padding: 5, borderLeftWidth: 1, borderLeftColor: '#eee' },
  iconTouch: { padding: 8 },
  actionIcon: { fontSize: 20 },
  floatingFooter: { position: 'absolute', bottom: 30, left: 0, right: 0, alignItems: 'center' },
  finishButtonList: { backgroundColor: '#3498db', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 30, elevation: 5 },
  finishButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  finishButton: { backgroundColor: '#27ae60' },

  // テスト画面
  testHeader: { flexDirection: 'row', justifyContent: 'space-between', width: '90%', marginBottom: 10, alignItems: 'center' },
  questionCard: { backgroundColor: '#fff', width: '90%', padding: 40, borderRadius: 15, alignItems: 'center', marginBottom: 30, elevation: 3 },
  questionText: { fontSize: 36, fontWeight: 'bold', color: '#2c3e50' },
  choicesContainer: { width: '90%', paddingBottom: 40 },
  choiceButton: { backgroundColor: '#fff', padding: 18, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#ddd', alignItems: 'center', shadowColor:'#000', shadowOpacity:0.05, shadowRadius:3, elevation:1 },
  choiceButtonCorrect: { backgroundColor: '#2ecc71', borderColor: '#27ae60', borderWidth: 2 },
  choiceButtonWrong: { backgroundColor: '#e74c3c', borderColor: '#c0392b', borderWidth: 2 },
  choiceText: { fontSize: 18, color: '#34495e' },
  choiceTextWhite: { fontSize: 18, color: '#fff', fontWeight: 'bold' },

  // チュートリアル画面
  slideContainer: { alignItems: 'center', justifyContent: 'center', padding: 20 },
  slideCard: { width: '85%', padding: 30, backgroundColor: '#fff', borderRadius: 20, alignItems: 'center', elevation: 5, borderWidth: 2 },
  slideIcon: { fontSize: 60, marginBottom: 20 },
  slideTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 15 },
  slideContent: { fontSize: 16, color: '#555', textAlign: 'center', lineHeight: 24 },
  pagination: { flexDirection: 'row', justifyContent: 'center', marginBottom: 30 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ccc', marginHorizontal: 5 },
  dotActive: { backgroundColor: '#3498db', width: 12, height: 12 },
  tutorialButton: { backgroundColor: '#3498db', paddingVertical: 15, paddingHorizontal: 50, borderRadius: 30, elevation: 3, marginBottom: 50 },
  tutorialButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});