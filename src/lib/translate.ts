/**
 * 中文标签 -> 英文蛇形 ID。
 * 内置一份业务词表（零售 / 电商 / 履约 / 支付域），按「最长优先」切词后拼成 snake_case。
 * 没命中的中文会被丢掉；整段都没命中时用块自己的兜底词。
 */

/** 词表：中文 -> 英文（可以带下划线） */
export const TERMS: Record<string, string> = {
  // 动作
  生成: 'create', 创建: 'create', 新建: 'create', 提交: 'submit', 校验: 'validate', 验证: 'verify',
  检查: 'check', 查询: 'query', 获取: 'get', 读取: 'read', 写入: 'write', 更新: 'update', 修改: 'update',
  删除: 'delete', 取消: 'cancel', 关闭: 'close', 关单: 'close_order', 开启: 'open', 开始: 'start',
  结束: 'end', 完成: 'complete', 成功: 'success', 失败: 'fail', 支付: 'pay', 付款: 'pay', 收款: 'collect',
  退款: 'refund', 退货: 'return', 发货: 'ship', 收货: 'receive', 拣货: 'pick', 打包: 'pack',
  出库: 'outbound', 入库: 'inbound', 配送: 'deliver', 送达: 'deliver', 签收: 'sign', 结算: 'checkout',
  对账: 'reconcile', 开票: 'invoice', 核销: 'writeoff', 冻结: 'freeze', 解冻: 'unfreeze', 锁定: 'lock',
  解锁: 'unlock', 重试: 'retry', 补偿: 'compensate', 回滚: 'rollback', 通知: 'notify', 推送: 'push',
  发送: 'send', 接收: 'receive', 拉取: 'pull', 同步: 'sync', 导入: 'import', 导出: 'export',
  打印: 'print', 上传: 'upload', 下载: 'download', 审批: 'approve', 审核: 'audit', 驳回: 'reject',
  分单: 'split_order', 派单: 'dispatch', 抢单: 'grab_order', 分拣: 'sort', 盘点: 'stocktake',
  补货: 'replenish', 上架: 'list', 下架: 'delist', 调价: 'price_change', 促销: 'promote',
  优惠: 'discount', 优惠券: 'coupon', 积分: 'points', 会员: 'member', 注册: 'register', 登录: 'login',
  登出: 'logout', 授权: 'authorize', 认证: 'auth', 风控: 'risk', 超时: 'timeout', 重发: 'resend',
  定时: 'scheduled', 排队: 'queue', 限流: 'rate_limit', 熔断: 'circuit_break', 降级: 'degrade',
  监控: 'monitor', 告警: 'alert', 日志: 'log', 统计: 'statistic', 报表: 'report', 汇总: 'summary',
  计算: 'calculate', 分摊: 'allocate', 拆分: 'split', 合并: 'merge', 转换: 'convert', 映射: 'map',
  加密: 'encrypt', 解密: 'decrypt', 签名: 'sign', 验签: 'verify_sign', 排序: 'sort', 归档: 'archive',
  发布: 'publish', 订阅: 'subscribe', 消费: 'consume', 生产: 'produce', 投递: 'deliver_message',
  分账: 'split_payment', 提现: 'withdraw', 充值: 'recharge', 转账: 'transfer', 冻结金额: 'freeze_amount',
  取消订单: 'cancel_order', 超时关单: 'close_timeout', 自动: 'auto', 手动: 'manual', 人工: 'manual',

  // 名词
  订单: 'order', 订单号: 'order_no', 数据: 'data', 表: 'table', 用户: 'user', 顾客: 'customer',
  客户: 'customer', 商家: 'merchant', 商户: 'merchant', 门店: 'store', 店铺: 'shop', 商品: 'product',
  货品: 'goods', 库存: 'stock', 仓库: 'warehouse', 供应商: 'supplier', 联营商: 'partner',
  渠道: 'channel', 平台: 'platform', 配送商: 'delivery_partner', 支付服务商: 'payment_provider',
  自营商: 'self_operated', 集团: 'group', 分公司: 'branch', 财务: 'finance', 客服: 'service',
  收银员: 'cashier', 店长: 'manager', 品类主管: 'category_manager', 促销员: 'promoter',
  拣货员: 'picker', 配送员: 'courier', 角色: 'role', 岗位: 'post', 任务: 'task', 作业: 'job',
  流程: 'process', 步骤: 'step', 状态: 'status', 结果: 'result', 明细: 'detail', 单据: 'document',
  发票: 'invoice', 账单: 'bill', 合同: 'contract', 价格: 'price', 金额: 'amount', 数量: 'quantity',
  时间: 'time', 日期: 'date', 消息: 'message', 事件: 'event', 队列: 'queue', 主题: 'topic',
  缓存: 'cache', 数据库: 'database', 接口: 'api', 服务: 'service', 系统: 'system', 网关: 'gateway',
  手机号: 'phone', 地址: 'address', 物流: 'logistics', 快递: 'express', 运单: 'waybill',
  售后: 'after_sale', 工单: 'ticket', 评价: 'comment', 购物车: 'cart', 会话: 'session',
  库存充足: 'stock_enough', 库存不足: 'stock_short', 是否: 'whether', 判断: 'decision',
  条件: 'condition', 充足: 'enough', 不足: 'insufficient', 外部: 'external', 内部: 'internal',
  主: 'primary', 从: 'secondary', 备: 'backup', 其他: 'other', 无: 'none', 有: 'has',
  每日: 'daily', 每小时: 'hourly', 每周: 'weekly', 每月: 'monthly', 凌晨: 'dawn', 夜间: 'night',
  对账单: 'statement', 结算单: 'settlement', 供应链: 'supply_chain', 履约: 'fulfillment',
  仓: 'warehouse', 店: 'store', 人: 'person', 单: 'order', 表名: 'table_name',
}

const TERM_KEYS = Object.keys(TERMS).sort((a, b) => b.length - a.length)
const MAX_TERM_LEN = TERM_KEYS.reduce((m, k) => Math.max(m, k.length), 1)
const CJK = /[\u4e00-\u9fff]/

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch)
}

/** 把标签切成英文单词数组 */
export function translateToWords(label: string): string[] {
  const text = String(label ?? '').trim()
  if (!text) return []
  const words: string[] = []
  let i = 0

  const pushEnglish = (chunk: string) => {
    // 英文/数字原样保留，拆驼峰和下划线
    for (const part of chunk
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)) {
      words.push(part.toLowerCase())
    }
  }

  while (i < text.length) {
    const ch = text[i]
    if (isWordChar(ch)) {
      let j = i
      while (j < text.length && isWordChar(text[j])) j++
      pushEnglish(text.slice(i, j))
      i = j
      continue
    }
    if (CJK.test(ch)) {
      // 最长优先匹配词表
      let matched = ''
      const maxLen = Math.min(MAX_TERM_LEN, text.length - i)
      for (let len = maxLen; len >= 1; len--) {
        const candidate = text.slice(i, i + len)
        if (TERMS[candidate]) {
          matched = candidate
          break
        }
      }
      if (matched) {
        words.push(...TERMS[matched].split('_'))
        i += matched.length
      } else {
        i += 1 // 没命中就跳过这个字
      }
      continue
    }
    i += 1 // 标点、空格等
  }
  return words
}

/** 标签 -> 英文蛇形（不含前缀与随机后缀） */
export function toEnglishSlug(label: string, maxWords = 4): string {
  const words = translateToWords(label)
  return words.slice(0, maxWords).join('_')
}

const RANDOM_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function randomSuffix(len = 5): string {
  let out = ''
  for (let i = 0; i < len; i++) out += RANDOM_ALPHABET[Math.floor(Math.random() * RANDOM_ALPHABET.length)]
  return out
}

/** 生成 <前缀>_<英文蛇形>_<随机>；用来做节点 ID，例如 p_create_order_k3t9p */
export function makeNodeId(prefix: string, label: string, fallbackWord: string, taken: Set<string> = new Set()): string {
  const cleanPrefix = prefix.replace(/_+$/, '').replace(/[^A-Za-z0-9_]/g, '') || 'n'
  const slug = toEnglishSlug(label) || fallbackWord
  const base = `${cleanPrefix}_${slug}`
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = `${base}_${randomSuffix(attempt > 20 ? 8 : 5)}`
    if (!taken.has(id)) return id
  }
  return `${base}_${Date.now().toString(36)}`
}

/** 人工输入 ID 时做清洗：只保留 ASCII 字母数字下划线 */
export function sanitizeNodeId(raw: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return ''
  return /^[0-9]/.test(cleaned) ? `n_${cleaned}` : cleaned
}
