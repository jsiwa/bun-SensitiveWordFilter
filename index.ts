import { readdir, readFile } from "node:fs/promises";

class TrieNode {
  children: Map<string, TrieNode> = new Map();
  fail: TrieNode | null = null;
  end: boolean = false;
  length: number = 0;  // 敏感词的长度

  addWord(word: string) {
    let node: TrieNode = this;  // 使用 TrieNode 替代 this 类型
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char)!;  // 通过一次Map.get来更新节点
    }
    node.end = true;
    node.length = word.length;  // 存储单词的长度，用于后续的位置确定
  }

  buildFailPointers() {
    const queue: TrieNode[] = [];
    this.fail = null;
    queue.push(this);

    while (queue.length > 0) {
      const current = queue.shift()!;
      current.children.forEach((childNode, char) => {
        if (current === this) {
          childNode.fail = this;
        } else {
          let fail = current.fail;
          while (fail !== null && !fail.children.has(char)) {
            fail = fail.fail;
          }
          childNode.fail = fail ? (fail.children.get(char) || null) : this;
        }
        queue.push(childNode);
      });
    }
  }
}

class SensitiveWordFilter {
  root: TrieNode = new TrieNode();

  async loadSensitiveWords(dir: string) {
    const files = await readdir(dir);
    for (const file of files) {
      if (file.endsWith(".txt")) {
        const content = await readFile(`${dir}/${file}`, "utf8");
        content.split("\n").forEach(word => {
          if (word.trim()) {
            this.root.addWord(word.trim());
          }
        });
      }
    }
    this.root.buildFailPointers();
  }

  findSensitiveWords(text: string) {
    let node: TrieNode = this.root;
    let currentIndex = 0;
    let foundWords: { word: string, start: number, end: number }[] = [];

    for (const char of text) {
      while (node !== this.root && !node.children.has(char)) {
        node = node.fail!;
      }
      node = node.children.get(char) || this.root;
      let tempNode = node;

      while (tempNode !== this.root) {
        if (tempNode.end) {
          const wordLength = tempNode.length;
          foundWords.push({
            word: text.substring(currentIndex - wordLength + 1, currentIndex + 1),
            start: currentIndex - wordLength + 1,
            end: currentIndex
          });
        }
        tempNode = tempNode.fail!;
      }
      currentIndex++;
    }
    return foundWords;
  }

  findSensitiveWordsFuzzy(text: string, maxSkip: number = 5): { word: string, start: number, end: number }[] {
    let node: TrieNode = this.root;
    let foundWords: { word: string, start: number, end: number }[] = [];
    let activeRegions: number[] = Array(text.length).fill(0);  // 用于跟踪已检测的区域

    for (let i = 0; i < text.length; i++) {
      if (activeRegions[i] === 1) continue; // 跳过已检测的部分

      let currentNode = node;
      let matchStart = i;
      let potentialEnd = i;  // 可能的敏感词结束位置
      let skipped = 0;  // 跟踪跳过的非关键字符数量

      for (let j = i; j < text.length; j++) {
        const char = text[j];

        if (currentNode.children.has(char)) {
          currentNode = currentNode.children.get(char)!;
          potentialEnd = j;  // 更新敏感词的潜在结束位置
          skipped = 0;  // 重置跳过的字符数量

          if (currentNode.end) {  // 找到一个完整的敏感词
            foundWords.push({
              word: text.substring(matchStart, potentialEnd + 1),
              start: matchStart,
              end: potentialEnd
            });
            // 标记这个区域已被检测
            for (let k = matchStart; k <= potentialEnd; k++) {
              activeRegions[k] = 1;
            }
            break;  // 找到匹配后跳出内层循环
          }
        } else if (currentNode !== this.root && skipped < maxSkip) {
          // 允许跳过一定数量的非关键字符
          skipped++;
        } else {
          break;  // 超出跳过限制或回到根节点，终止内部循环
        }
      }
    }

    return foundWords;
  }
}

// 示例用法
const filter = new SensitiveWordFilter();
await filter.loadSensitiveWords("./sensitive_words");
async function runFilter() {

  const content = await readFile('./test.txt', "utf8")

  console.time('test')
  const results = filter.findSensitiveWords(content);
  console.timeEnd('test')

  console.time('fuzzy')
  const resultsFuzzy = filter.findSensitiveWordsFuzzy(content);
  console.timeEnd('fuzzy')
  console.log(resultsFuzzy)
}

runFilter();

const server = Bun.serve({
  port: 8080,
  async fetch(request) {
    const content = await (await request.blob()).text()
    const results = filter.findSensitiveWords(content);
    return new Response(JSON.stringify(results, null, 2));
  },
});

console.log(`Listening on localhost:${server.port}`);
