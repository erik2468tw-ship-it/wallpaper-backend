const fs = require('fs');
const content = `function addChinesePunctuation(text) {
    let cleaned = text.replace(/[，。？！；：、""''（）]/g, '');
    cleaned = cleaned.trim();
    if (!cleaned) return text;
    
    const qChars = '嗎吧呢啊哦呀';
    const hasQChar = qChars.split('').some(c => cleaned.endsWith(c));
    const qStarts = ['什麼','哪','誰','怎麼','為什麼','多少','幾','是否','有沒有','是不是','能不能','要不要'];
    const startsWithQ = qStarts.some(q => cleaned.startsWith(q));
    const isQuestion = hasQChar || startsWithQ;
    
    if (!/[。？！]$/.test(cleaned)) {
        cleaned += isQuestion ? '？' : '。';
    }
    
    return cleaned;
}
`;
fs.writeFileSync('C:/Users/seewell/.openclaw/workspace/wallpaper-backend/addChinesePunct.txt', content, 'utf8');
