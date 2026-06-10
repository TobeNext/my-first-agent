import { array, number } from "zod";
import { fa, ta, tr } from "zod/v4/locales";

function longestConsecutive(nums: number[]): number {
    if(nums.length == 0) return 0;
    var num = new Set<number>();
    for (let index = 0; index < nums.length; index++) {
        num.add(nums[index]);
    }

    var result = 0;
    for (const element of num) {
        if(!num.has(element+1)){
            var curCount = 1;
            var curNum = element;
            while(num.has(curNum-1)){
                curCount += 1;
                curNum -= 1;
            }
            result = Math.max(result, curCount);
        }
    }
    return result + 1;
};

function moveZeroes(nums: number[]): void {
    var left = 0;
    var right = 0;
    while(right < nums.length) {
        if (nums[right] != 0) {
            swap(nums, left, right);
            left++;
        }
        right++;
    }

};

function swap(nums: number[], left: number, right: number) {
    var tmp = nums[left];
    nums[left] = nums[right];
    nums[right] = tmp;
}


function maxArea(height: number[]): number {
    var left = 0;
    var right = height.length - 1;
    var max = 0;
    while(left < right) {
        var cur = 0;
        if(height[left] < height[right]){
            cur = height[left] * (right - left);
            left++;
        }else{
            cur = height[right] * (right - left);
            right--;
        }
        max = Math.max(cur, max);
    }
    return max;
};


function threeSum(nums: number[]): number[][] {
  nums.sort((a, b) => a - b);

  const ans: number[][] = [];
  const n = nums.length;

  for (let first = 0; first < n; first++) {
    if (first > 0 && nums[first] === nums[first - 1]) {
      continue;
    }

    let third = n - 1;
    const target = -nums[first];

    for (let second = first + 1; second < n; second++) {
      if (second > first + 1 && nums[second] === nums[second - 1]) {
        continue;
      }

      while (second < third && nums[second] + nums[third] > target) {
        third--;
      }

      if (second === third) {
        break;
      }

      if (nums[second] + nums[third] === target) {
        ans.push([nums[first], nums[second], nums[third]]);
      }
    }
  }

  return ans;
    
};


function lengthOfLongestSubstring(s: string): number {
    var set = new Set();
    var n = s.length, right = -1, ans = 0;
    for (let index = 0; index < s.length; index++) {
        if(index != 0){
            set.delete(s.charAt(index - 1));
        }
        while(right + 1 < n && !set.has(s.charAt(right + 1))) {
            set.add(s.charAt(right + 1));
            right++;
        }
        ans = Math.max(ans, right - index + 1);
    }
    return ans;
};


function findAnagrams(s: string, p: string): number[] {
    const sLen = s.length, pLen = p.length;

    if (sLen < pLen) {
        return [];
    }

    const baseCode: number = 'a'.charCodeAt(0);

    const ans = [];
    const sCount = new Array(26).fill(0);
    const pCount = new Array(26).fill(0);
    for (let i = 0; i < pLen; ++i) {
        ++sCount[s.charCodeAt(i) - baseCode];
        ++pCount[p.charCodeAt(i) - baseCode];
    }

    if (sCount.toString() === pCount.toString()) {
        ans.push(0);
    }

    for (let i = 0; i < sLen - pLen; ++i) {
        --sCount[s.charCodeAt(i) - baseCode];
        ++sCount[s.charCodeAt(i + pLen) - baseCode];

        if (sCount.toString() === pCount.toString()) {
            ans.push(i + 1);
        }
    }

    return ans;
}


function subarraySum1(nums: number[], k: number): number {
    var ans = 0;
    for (let i = 0; i < nums.length; i++) {
        var sum = 0;
        for (let j = i; j >= 0; j--) {
            sum += nums[j];
            if (sum == k) {
                ans++;
            }
        }
    }
    return ans;
};


function subarraySum(nums: number[], k: number): number {
    var map = new Map();
    var sum = 0, count = 0;
    map.set(0, 1);
    for (const num of nums) {
        sum += num;
        if (map.has(sum - k)) {
            count += map.get(sum - k);
        }
        if (map.has(sum)) {
            map.set(sum, map.get(sum) + 1);
        }else{
            map.set(sum, 1);
        }
    }
    return count;
};

function maxSubArray(nums: number[]): number {
    var res = - Number.MAX_VALUE, sum = 0;
    for (const num of nums) {
        sum = Math.max(sum+num, num);
        res = Math.max(res, sum);
    }
    return res;
};

function merge(intervals: number[][]): number[][] {
    function merge(intervals: number[][]): number[][] {
    intervals.sort((a, b) => a[0] - b[0]);

    const res: number[][] = [];

    for (const interval of intervals) {
        const left = interval[0];
        const right = interval[1];

        if (res.length === 0 || res[res.length - 1][1] < left) {
            res.push([left, right]);
        } else {
            res[res.length - 1][1] = Math.max(
                res[res.length - 1][1],
                right
            );
        }
    }

    return res;
}
};


function rotate(nums: number[], k: number): void {
    var res = new Array(nums.length).fill(0);
    for (let i = 0; i < nums.length; i++) {
        var newIndex = (i + k) % nums.length;
        res[newIndex] = nums[i];
    }
    nums.splice(0, nums.length, ...res);
};


 class ListNode {
    val: number
    next: ListNode | null
    constructor(val?: number, next?: ListNode | null) {
        this.val = (val===undefined ? 0 : val)
        this.next = (next===undefined ? null : next)
    }
 }

function getIntersectionNode(headA: ListNode | null, headB: ListNode | null): ListNode | null {
    if(headA == null || headB == null) return null;
    var aIndex: ListNode | null = headA, bIndex: ListNode | null = headB;
    while(aIndex !== bIndex){
        aIndex = aIndex === null ? headB : aIndex.next;
        bIndex = bIndex === null ? headA : bIndex.next;
    }
    return aIndex;
};

function reverseList(head: ListNode | null): ListNode | null {
    var pre: ListNode | null = null;
    var cur = head;
    if(cur === null || cur.next === null) return head;
    while(cur !== null) {
        var tmp: ListNode | null = cur.next;
        cur.next = pre;
        pre = cur;
        cur = tmp;
    }
    return pre;
};

function isPalindrome(head: ListNode | null): boolean {
    const arr: number[] = [];

    let cur: ListNode | null = head;

    while (cur !== null) {
        arr.push(cur.val);
        cur = cur.next;
    }

    let left = 0;
    let right = arr.length - 1;

    while (left < right) {
        if (arr[left] !== arr[right]) {
            return false;
        }

        left++;
        right--;
    }

    return true;
}

function hasCycle(head: ListNode | null): boolean {
    if (head === null || head.next === null) {
        return false;
    }
    var slow: ListNode | null = head;
    var fast: ListNode | null = head.next;
    while(slow != fast) {
        if(slow === null || fast === null || fast?.next === null) {
            return false;
        }
        slow = slow.next;
        fast = fast.next.next;
    }
    return true;
};


function detectCycle(head: ListNode | null): ListNode | null {
    if (head === null || head.next === null) {
        return null;
    }
    var slow: ListNode | null = head;
    var fast: ListNode | null = head.next;
    while(slow != fast) {
        if(slow === null || fast === null || fast?.next === null) {
            return null;
        }
        slow = slow.next;
        fast = fast.next.next;
    }
    var set = new Set();
    while(!set.has(slow) && slow !== null){
        set.add(slow);
        slow = slow.next;
    }
    slow = head;
    while(!set.has(slow) && slow !== null){
        slow = slow.next;
    }
    return slow;
};

function mergeTwoLists(list1: ListNode | null, list2: ListNode | null): ListNode | null {
    let res = new ListNode(0), cur = res
    while (list1 && list2) {
        if (list1.val <= list2.val) {
            cur.next = list1
            list1 = list1.next
        } else {
            cur.next = list2
            list2 = list2.next
        }
        cur = cur.next
    }
    cur.next = list1 ?? list2;
    return res.next
};

function removeNthFromEnd(head: ListNode | null, n: number): ListNode | null {
    const dummy = new ListNode(0, head);

    let first: ListNode | null = head;
    let second: ListNode | null = dummy;

    for (let i = 0; i < n; i++) {
        first = first!.next;
    }

    while (first !== null) {
        first = first.next;
        second = second!.next;
    }

    second!.next = second!.next!.next;

    return dummy.next;
};


function swapPairs(head: ListNode | null): ListNode | null {
    const dummyHead = new ListNode(0, head);

    let temp: ListNode | null = dummyHead;

    while (temp.next !== null && temp.next.next !== null) {
        const node1: ListNode = temp.next;
        const node2: ListNode = temp.next.next;

        temp.next = node2;
        node1.next = node2.next;
        node2.next = node1;

        temp = node1;
    }

    return dummyHead.next;
};

  class _Node {
      val: number
      next: _Node | null
      random: _Node | null
  
      constructor(val?: number, next?: _Node, random?: _Node) {
          this.val = (val===undefined ? 0 : val)
          this.next = (next===undefined ? null : next)
          this.random = (random===undefined ? null : random)
      }
  }

function copyRandomList(head: _Node | null, cacheNode: Map<_Node, _Node> = new Map()): _Node | null {
    if (head === null) {
        return null;
    }

    if (!cacheNode.has(head)) {
        var cur = new _Node(head.val);
        cacheNode.set(head, cur);

        cur.next = copyRandomList(head.next, cacheNode);
        cur.random = copyRandomList(head.random, cacheNode);

    }

    return cacheNode.get(head)!;
};


function sortList(head: ListNode | null): ListNode | null {
    if (head === null) {
        return null;
    }
    return toSortList(head, null)
};

function toSortList(head: ListNode | null, tail: ListNode | null): ListNode | null {
    if (head === null) {
        return null;
    }
    if (head.next === tail) {
        head.next = null;
        return head;
    }
    var slow: ListNode | null = head, fast: ListNode | null = head;
    while (fast !== tail) {
        slow = slow!.next;
        fast = fast!.next;
        if (fast !== tail) {
            fast = fast!.next;
        }
    }
    var mid = slow;
    return mergeLists(toSortList(head, mid), toSortList(mid, tail));
};

function mergeLists(head: ListNode | null, tail: ListNode | null): ListNode | null{
    var dummyHead = new ListNode(0);
    var tmp = dummyHead, tmp1 = head, tmp2 = tail;
    while (tmp1 !== null && tmp2 !== null) {
        if (tmp1.val <= tmp2.val) {
            tmp.next = tmp1;
            tmp1 = tmp1.next;
        } else {
            tmp.next = tmp2;
            tmp2 = tmp2.next;
        }
        tmp = tmp.next;
    }
    if (tmp1 !== null) {
        tmp.next = tmp1;
    } else if (tmp2 !== null){
        tmp.next = tmp2;
    }

    return dummyHead.next;
}

class LRUCache {

    cap: number;
    map: Map<number, number> = new Map()

    constructor(capacity: number) {
        this.cap = capacity;
        this.map = new Map();
    }


    get(key: number): number {
        if (this.map.has(key)) {
            var value: number = this.map.get(key)!;
            this.map.delete(key);
            this.map.set(key, value);
            return value;
        }
        return -1;
    }

    put(key: number, value: number): void {
        if (this.map.has(key)) {
            this.map.delete(key);
        }
        this.map.set(key, value);

        if (this.map.size > this.cap) {
            this.map.delete(this.map.keys().next().value!)
        }
    }
}


 class TreeNode {
      val: number
      left: TreeNode | null
      right: TreeNode | null
      constructor(val?: number, left?: TreeNode | null, right?: TreeNode | null) {
          this.val = (val===undefined ? 0 : val)
          this.left = (left===undefined ? null : left)
          this.right = (right===undefined ? null : right)
      }
  }



function inorderTraversal(root: TreeNode | null): number[] {
    var res = new Array<number>();
    inorderTraversalCore(root, res);
    return res;
};

function inorderTraversalCore(root: TreeNode | null, res: Array<number> = new Array) {
    if (root === null) {
        return null;
    }
    inorderTraversalCore(root.left, res);
    res.push(root.val);
    inorderTraversalCore(root.right, res);
};

function maxDepth(root: TreeNode | null): number {
    if (root === null) {
        return 0;
    }
    var list = new Array<TreeNode | null>(), res = 1;
    if(root.left !== null) list.push(root.left);
    if(root.right !== null) list.push(root.right);
    while(list.length !== 0) {
        var curLayer = new Array<TreeNode | null>()
        while (list.length !== 0) {
            var curNode = list.pop();
            if (curNode!.left !== null) {
                curLayer.push(curNode!.left);
            }
            if (curNode!.right !== null) {
                curLayer.push(curNode!.right);
            }
        }
        res++;
        list = curLayer;
    }
    return res;
};

function maxDepth2(root: TreeNode | null): number {
    if (root === null) {
        return 0;
    } else {
        var l = maxDepth2(root.left);
        var r = maxDepth2(root.right);
        return Math.max(l,r) + 1;
    }
};


function invertTree(root: TreeNode | null): TreeNode | null {
    if (root === null) {
        return null;
    }
    invertTree(root.left);
    invertTree(root.right);
    var tmp = root.left;
    root.left = root.right;
    root.right = tmp;

    return root;
};

function isSymmetric(root: TreeNode | null): boolean {
    if (root === null) {
        return true;
    }
    return isSymmetricCore(root, root);
};

function isSymmetricCore(p: TreeNode | null, q: TreeNode | null): boolean {
    if (p === null && q === null) {
        return true;
    }
    if (p === null|| q === null) {
        return false;
    }
    return p.val === q.val && isSymmetricCore(p.left, q.right) && isSymmetricCore(p.right, q.left);
};

var ans: number;

function diameterOfBinaryTree(root: TreeNode | null): number {
    ans = 1;
    diameterOfBinaryTreeCore(root);
    return ans - 1;
};

function diameterOfBinaryTreeCore(root: TreeNode | null): number {
    if (root === null) {
        return 0;
    }
    var L = diameterOfBinaryTreeCore(root.left);
    var R = diameterOfBinaryTreeCore(root.right);
    return Math.max(L + R + 1, ans)
};

function levelOrder(root: TreeNode | null): number[][] {
    const ret: number[][] = [];

    if (root === null) {
        return ret;
    }

    const q: TreeNode[] = [];
    q.push(root);

    while (q.length !== 0) {
        const currentLevelSize = q.length;
        const currentLevel: number[] = [];

        for (let i = 0; i < currentLevelSize; i++) {
            const node = q.shift()!;

            currentLevel.push(node.val);

            if (node.left !== null) {
                q.push(node.left);
            }

            if (node.right !== null) {
                q.push(node.right);
            }
        }

        ret.push(currentLevel);
    }

    return ret;
}

function sortedArrayToBST(nums: number[]): TreeNode | null {
    return sortedArrayToBSTCore(nums, 0, nums.length - 1);
};

function sortedArrayToBSTCore(nums: number[], left: number, right: number): TreeNode | null {
    if (left > right) {
        return null;
    }
    const mid = Math.floor((left + right) / 2);
    var newNode = new TreeNode();
    newNode.val = nums[mid];
    newNode.left = sortedArrayToBSTCore(nums, left, mid - 1);
    newNode.right = sortedArrayToBSTCore(nums, mid + 1, right);
    return newNode;
};


function isValidBST(root: TreeNode | null): boolean {
    const stack: TreeNode[] = [];
    let inorder = -Infinity;

    while (stack.length > 0 || root !== null) {
        while (root !== null) {
            stack.push(root);
            root = root.left;
        }

        const node = stack.pop()!;

        if (node.val <= inorder) {
            return false;
        }

        inorder = node.val;
        root = node.right;
    }

    return true;
};

function kthSmallest(root: TreeNode | null, k: number): number {
    var stack = [];
    while (root !== null || stack.length) {
        while (root !== null) {
            stack.push(root);
            root = root.left;
        }
        root = stack.pop()!;
        k--;
        if (k === 0) {
            break;
        }

        root = root.right;
    }

    return root!.val;
};

function rightSideView(root: TreeNode | null): number[] {
    if (root === null) {
        return [];
    }
    var stack: TreeNode[] = [];
    var res: number[] = [];
    stack.push(root);
    while (stack.length !== 0) {
        var n = stack.length;
        for (let i = 0; i < n; i++) {
            var node: TreeNode = stack.shift()!;
            if (i === n - 1) {
                res.push(node.val);
            }
            if(node.left !== null) stack.push(node.left);
            if(node.right !== null) stack.push(node.right);
        }
    }
    return res;
};

function flatten(root: TreeNode | null): void {
    const list: TreeNode[] = [];

    preorderTraversal(root, list);

    const size = list.length;

    for (let i = 1; i < size; i++) {
        const prev = list[i - 1];
        const curr = list[i];

        prev.left = null;
        prev.right = curr;
    }
}

function preorderTraversal(root: TreeNode | null, list: TreeNode[]): void {
    if (root !== null) {
        list.push(root);
        preorderTraversal(root.left, list);
        preorderTraversal(root.right, list);
    }
}

var indexMap: Map<number, number>;

function buildTree(preorder: number[], inorder: number[]): TreeNode | null {
    var n = preorder.length;
    indexMap = new Map();
    for (let i = 0; i  < n; i++) {
        indexMap.set(inorder[i], i);
    }
    return buildTreeCore(preorder, inorder, 0, n-1, 0, n-1);
};

function buildTreeCore(preorder: number[], inorder: number[], preorderLeft: number, preorderRight: number, inorderLeft: number, inorderRight: number): TreeNode | null {
    if (preorderLeft > preorderRight) {
        return null;
    }

    var preorderRoot = preorderLeft;
    var inorderRoot: number = indexMap.get(preorder[preorderRoot])!;

    var leftTreeSize = inorderRoot - inorderLeft;
    var newNode = new TreeNode(preorder[preorderRoot]);
    
    newNode.left = buildTreeCore(preorder, inorder, preorderLeft + 1, preorderLeft + leftTreeSize, inorderLeft, inorderRoot - 1);
    newNode.right = buildTreeCore(preorder, inorder, preorderLeft + leftTreeSize + 1, preorderRight, inorderRoot + 1, inorderRight);

    return newNode;
};

var LowestCommonAncestor: TreeNode | null = null;

function lowestCommonAncestor(root: TreeNode | null, p: TreeNode | null, q: TreeNode | null): TreeNode | null {
    lowestCommonAncestorCore(root, p, q);
    return LowestCommonAncestor;
};

function lowestCommonAncestorCore(root: TreeNode | null, p: TreeNode | null, q: TreeNode | null): boolean {
	if (root === null) {
        return false;
    }
    var l = lowestCommonAncestorCore(root.left, p , q);
    var r = lowestCommonAncestorCore(root.right, p , q);
    if ((l && r) || ((root.val === p!.val || root.val === q!.val) && (l || r))) {
        LowestCommonAncestor = root;
    }
    return l || r || (root.val === p!.val || root.val === q!.val)
};



function pathSum(root: TreeNode | null, targetSum: number): number {
    var map = new Map();
    map.set(0, 1);
    return pathSumCore(root, targetSum, map, 0);
};

function pathSumCore(root: TreeNode | null, targetSum: number, map: Map<number, number>, curr: number): number {
    if (root === null) {
        return 0;
    }

    var ret = 0;
    curr += root.val;

    ret = map.get(curr - targetSum) || 0;
    map.set(curr, (map.get(curr) || 0) + 1);
    ret += pathSumCore(root.left, targetSum, map, curr);
    ret += pathSumCore(root.right, targetSum, map, curr);
    map.set(curr, (map.get(curr) || 0) - 1);

    return ret;
};

function numIslands(grid: string[][]): number {
    if (grid === null || grid.length === 0) {
        return 0;
    }

    const nr = grid.length;
    const nc = grid[0].length;
    let numIslands = 0;

    function dfs(r: number, c: number): void {
        if (
            r < 0 ||
            c < 0 ||
            r >= nr ||
            c >= nc ||
            grid[r][c] === '0'
        ) {
            return;
        }

        grid[r][c] = '0';

        dfs(r - 1, c);
        dfs(r + 1, c);
        dfs(r, c - 1);
        dfs(r, c + 1);
    }

    for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
            if (grid[r][c] === '1') {
                numIslands++;
                dfs(r, c);
            }
        }
    }

    return numIslands;
}

function orangesRotting(grid: number[][]): number {
    const rows = grid.length;
    const cols = grid[0].length;

    const queue: { row: number; col: number; minute: number }[] = [];
    let freshCount = 0;

    // 1. 先遍历整个网格
    // 找到所有腐烂橘子，放入队列
    // 同时统计新鲜橘子的数量
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (grid[row][col] === 2) {
                queue.push({
                    row,
                    col,
                    minute: 0
                });
            }

            if (grid[row][col] === 1) {
                freshCount++;
            }
        }
    }

    const directions = [
        [-1, 0], // 上
        [1, 0],  // 下
        [0, -1], // 左
        [0, 1]   // 右
    ];

    let maxMinute = 0;

    // 2. BFS 扩散腐烂过程
    while (queue.length > 0) {
        const current = queue.shift()!;

        const currentRow = current.row;
        const currentCol = current.col;
        const currentMinute = current.minute;

        for (const [rowOffset, colOffset] of directions) {
            const nextRow = currentRow + rowOffset;
            const nextCol = currentCol + colOffset;

            const isInGrid =
                nextRow >= 0 &&
                nextRow < rows &&
                nextCol >= 0 &&
                nextCol < cols;

            if (!isInGrid) {
                continue;
            }

            const isFreshOrange = grid[nextRow][nextCol] === 1;

            if (!isFreshOrange) {
                continue;
            }

            // 3. 新鲜橘子被感染
            grid[nextRow][nextCol] = 2;
            freshCount--;

            const nextMinute = currentMinute + 1;
            maxMinute = Math.max(maxMinute, nextMinute);

            queue.push({
                row: nextRow,
                col: nextCol,
                minute: nextMinute
            });
        }
    }

    // 4. 如果还有新鲜橘子，说明无法全部腐烂
    if (freshCount > 0) {
        return -1;
    }

    return maxMinute;
}

class TrieNode {
    children: Map<string, TrieNode>;
    isEnd: boolean;

    constructor() {
        this.children = new Map();
        this.isEnd = false;
    }
}

class Trie {
    private root: TrieNode;

    constructor() {
        this.root = new TrieNode();
    }

    insert(word: string): void {
        let node = this.root;

        for (const char of word) {
            if (!node.children.has(char)) {
                node.children.set(char, new TrieNode());
            }

            node = node.children.get(char)!;
        }

        node.isEnd = true;
    }

    search(word: string): boolean {
        let node = this.root;

        for (const char of word) {
            if (!node.children.has(char)) {
                return false;
            }

            node = node.children.get(char)!;
        }

        return node.isEnd;
    }

    startsWith(prefix: string): boolean {
        let node = this.root;

        for (const char of prefix) {
            if (!node.children.has(char)) {
                return false;
            }

            node = node.children.get(char)!;
        }

        return true;
    }
}


function canFinish(numCourses: number, prerequisites: number[][]): boolean {
    var graph: number[][] = Array.from({length: numCourses}, () => []);
    var inDegree = new Array(numCourses).fill(0);

    for (const [course, pre] of prerequisites) {
        graph[pre].push(course);
        inDegree[course]++;
    }

    var queue: number[] = [];

    for (let i = 0; i < inDegree.length; i++) {
        if (inDegree[i] === 0) {
            queue.push(i);
        }
    }

    var learnCount = 0, index = 0;
    while(queue.length > index){
        var cur = queue[index];
        index++;
        learnCount++;

        for (const next of graph[cur]) {
            inDegree[next]--;
            if (inDegree[next] === 0) {
                queue.push(next);
            }
        }
    }

    return learnCount === numCourses;
};

var permuteRes: number[][];
var permutePath: number[];
function permute(nums: number[]): number[][] {
    permuteRes = [];
    permutePath = [];
    var used: boolean[] = new Array(nums.length).fill(false);
    function permuteCore(){
        if (nums.length === permutePath.length) {
            permuteRes.push([...permutePath]);
            return;
        }  
        for (let i = 0; i < nums.length; i++) {
            if (used[i]) {
                continue;
            }

            permutePath.push(nums[i]);
            used[i] = true;
            permuteCore();
            permutePath.pop();
            used[i] = false;
        }
    }
    permuteCore();
    return permuteRes;
};

function subsets(nums: number[]): number[][] {
    var res: number[][] = [];
    var subsetsPath: number[] = [];
    function subsetsCore(index: number){
        res.push([...subsetsPath]);
        for (let i = index; i < nums.length; i++) {
            subsetsPath.push(nums[i]);
            subsetsCore(i + 1);
            subsetsPath.pop();
        }
    }
    subsetsCore(0);
    return res;
};


function letterCombinations(digits: string): string[] {
    const combinations: string[] = [];

    if (digits.length === 0) {
        return combinations;
    }

    const phoneMap = new Map<string, string>([
        ["2", "abc"],
        ["3", "def"],
        ["4", "ghi"],
        ["5", "jkl"],
        ["6", "mno"],
        ["7", "pqrs"],
        ["8", "tuv"],
        ["9", "wxyz"],
    ]);

    function backtrack(index: number, combination: string[]): void {
        if (index === digits.length) {
            combinations.push(combination.join(""));
            return;
        }

        const digit = digits[index];
        const letters = phoneMap.get(digit)!;

        for (let i = 0; i < letters.length; i++) {
            combination.push(letters[i]);
            backtrack(index + 1, combination);
            combination.pop();
        }
    }

    backtrack(0, []);
    return combinations;
}


function combinationSum(candidates: number[], target: number): number[][] {
    var combinationSumRes: number[][] = [];
    var combinationSumPath: number[] = [];
    candidates.sort();

    function backtrack(sum: number, index: number): void {
        if (sum === target) {
            combinationSumRes.push([...combinationSumPath]);
            return;
        }
        if (sum > target) {
            return;
        }
        for (let i = index; i < candidates.length; i++) {
            sum += candidates[i];
            combinationSumPath.push(candidates[i]);

            backtrack(sum, i);

            sum -= candidates[i];
            combinationSumPath.pop();
        }
    }
    backtrack(0, 0);
    return combinationSumRes;
};

function generateParenthesis(n: number): string[] {
    const ans: string[] = [];
    const cur: string[] = [];

    function backtrack(open: number, close: number): void {
        if (cur.length === n * 2) {
            ans.push(cur.join(""));
            return;
        }

        if (open < n) {
            cur.push("(");
            backtrack(open + 1, close);
            cur.pop();
        }

        if (close < open) {
            cur.push(")");
            backtrack(open, close + 1);
            cur.pop();
        }
    }

    backtrack(0, 0);
    return ans;
}

function exist(board: string[][], word: string): boolean {
    const h: number = board.length;
    const w: number = board[0].length;

    const directions: number[][] = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
    ];

    const visited: boolean[][] = new Array(h)
        .fill(0)
        .map(() => new Array(w).fill(false));

    function check(i: number, j: number, k: number): boolean {
        if (board[i][j] !== word.charAt(k)) {
            return false;
        }

        if (k === word.length - 1) {
            return true;
        }

        visited[i][j] = true;

        for (const [dx, dy] of directions) {
            const newI = i + dx;
            const newJ = j + dy;

            if (
                newI >= 0 &&
                newI < h &&
                newJ >= 0 &&
                newJ < w &&
                !visited[newI][newJ]
            ) {
                if (check(newI, newJ, k + 1)) {
                    visited[i][j] = false;
                    return true;
                }
            }
        }

        visited[i][j] = false;
        return false;
    }

    for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
            if (check(i, j, 0)) {
                return true;
            }
        }
    }

    return false;
}

function partition(s: string): string[][] {
    const result: string[][] = [];
    const path: string[] = [];

    function isPalindrome(left: number, right: number): boolean {
        while (left < right) {
            if (s[left] !== s[right]) {
                return false;
            }
            left++;
            right--;
        }
        return true;
    }

    function backtrack(startIndex: number): void {
        if (startIndex === s.length) {
            result.push([...path]);
            return;
        }

        for (let i = startIndex; i < s.length; i++) {
            if (!isPalindrome(startIndex, i)) {
                continue;
            }

            const str = s.slice(startIndex, i + 1);
            path.push(str);

            backtrack(i + 1);

            path.pop();
        }
    }

    backtrack(0);
    return result;
}

function searchInsert(nums: number[], target: number): number {
    var left = 0, right = nums.length - 1;
    while (left <= right) {
        var mid = left + Math.floor((right - left) / 2);

        if (nums[mid] === target) {
            return mid;
        } else if (nums[mid] > target) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }
    return left;
};

function searchMatrix(matrix: number[][], target: number): boolean {
    const m: number = matrix.length;
    const n: number = matrix[0].length;

    let low: number = 0;
    let high: number = m * n - 1;

    while (low <= high) {
        const mid: number = low + Math.floor((high - low) / 2);

        const row: number = Math.floor(mid / n);
        const col: number = mid % n;

        const x: number = matrix[row][col];

        if (x < target) {
            low = mid + 1;
        } else if (x > target) {
            high = mid - 1;
        } else {
            return true;
        }
    }

    return false;
}