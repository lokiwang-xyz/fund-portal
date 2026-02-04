import React, { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { ethers } from 'ethers';

// ============ 配置 ============
const CONFIG = {
  // 你的合约地址（Base Sepolia测试网）
  contractAddress: '0xF4a8A48813b6edF75E53f21A993D9f72147d86C8',
  // Base Sepolia测试网
  chainId: 84532,
  chainName: 'Base Sepolia',
  rpcUrl: 'https://sepolia.base.org',
  blockExplorer: 'https://sepolia.basescan.org',
  // 切换到主网时使用：
  // chainId: 8453,
  // chainName: 'Base',
  // rpcUrl: 'https://mainnet.base.org',
  // blockExplorer: 'https://basescan.org',
};

// ============ 合约ABI ============
const FUND_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function whitelist(address) view returns (bool)",
  "function getCurrentNAV() view returns (uint256)",
  "function getNavHistoryLength() view returns (uint256)",
  "function navHistory(uint256) view returns (uint256 timestamp, uint256 nav, uint256 totalShares, uint256 totalAssets, string ipfsHash)",
  "function lpInfo(address) view returns (uint256 initialInvestment, uint256 investmentDate, bool isActive)",
  "function getLPValue(address) view returns (uint256)",
  "function getLPReturn(address) view returns (int256)",
  "function getFundOverview() view returns (string name, string description, uint256 inceptionDate, uint256 currentNav, uint256 totalShares, uint256 totalAssets, uint256 lpCount)",
  "function fundName() view returns (string)",
  "function fundDescription() view returns (string)",
  "function fundInceptionDate() view returns (uint256)"
];

// ============ 工具函数 ============
const formatNumber = (num, decimals = 2) => {
  if (num === null || num === undefined) return '-';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num);
};

const formatUSD = (num) => {
  if (num === null || num === undefined) return '-';
  if (num >= 1000000) return `$${formatNumber(num / 1000000)}M`;
  if (num >= 1000) return `$${formatNumber(num / 1000)}K`;
  return `$${formatNumber(num)}`;
};

const formatDate = (timestamp) => {
  if (!timestamp) return '-';
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

const shortenAddress = (address) => {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

// ============ 主组件 ============
export default function App() {
  const [account, setAccount] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [fundData, setFundData] = useState(null);
  const [lpData, setLpData] = useState(null);
  const [navHistory, setNavHistory] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // 检测是否有钱包
  const hasWallet = typeof window !== 'undefined' && window.ethereum;

  // 获取只读provider
  const getProvider = () => {
    return new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  };

  // 获取合约实例（只读）
  const getContract = () => {
    const provider = getProvider();
    return new ethers.Contract(CONFIG.contractAddress, FUND_TOKEN_ABI, provider);
  };

  // 加载基金数据
  const loadFundData = useCallback(async () => {
    try {
      setLoading(true);
      const contract = getContract();
      
      const [name, description, nav, totalSupply, inceptionDate, historyLength] = await Promise.all([
        contract.fundName(),
        contract.fundDescription(),
        contract.getCurrentNAV(),
        contract.totalSupply(),
        contract.fundInceptionDate(),
        contract.getNavHistoryLength()
      ]);

      setFundData({
        name,
        description,
        currentNav: parseFloat(ethers.formatEther(nav)),
        totalShares: parseFloat(ethers.formatEther(totalSupply)),
        inceptionDate: Number(inceptionDate)
      });

      // 加载净值历史
      const historyLen = Number(historyLength);
      const history = [];
      for (let i = 0; i < historyLen; i++) {
        const record = await contract.navHistory(i);
        history.push({
          date: formatDate(Number(record.timestamp)),
          nav: parseFloat(ethers.formatEther(record.nav)),
          timestamp: Number(record.timestamp)
        });
      }
      setNavHistory(history);

    } catch (err) {
      console.error('Error loading fund data:', err);
      setError('Failed to load fund data. Please check the contract address.');
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载LP数据
  const loadLPData = useCallback(async (address) => {
    try {
      const contract = getContract();
      
      const [isWL, balance, value, returnRate, info] = await Promise.all([
        contract.whitelist(address),
        contract.balanceOf(address),
        contract.getLPValue(address),
        contract.getLPReturn(address),
        contract.lpInfo(address)
      ]);

      setIsWhitelisted(isWL);
      
      if (isWL) {
        setLpData({
          shares: parseFloat(ethers.formatEther(balance)),
          value: parseFloat(ethers.formatEther(value)),
          initialInvestment: parseFloat(ethers.formatEther(info.initialInvestment)),
          returnRate: Number(returnRate) / 100,
          investmentDate: Number(info.investmentDate)
        });
      }
    } catch (err) {
      console.error('Error loading LP data:', err);
    }
  }, []);

  // 连接钱包
  const connectWallet = async () => {
    if (!hasWallet) {
      setError('Please install MetaMask or another Web3 wallet');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      });

      if (accounts.length > 0) {
        // 检查网络
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (parseInt(chainId, 16) !== CONFIG.chainId) {
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${CONFIG.chainId.toString(16)}` }]
            });
          } catch (switchError) {
            if (switchError.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: `0x${CONFIG.chainId.toString(16)}`,
                  chainName: CONFIG.chainName,
                  rpcUrls: [CONFIG.rpcUrl],
                  blockExplorerUrls: [CONFIG.blockExplorer]
                }]
              });
            }
          }
        }

        // 先加载LP数据，再更新账户状态，确保UI同步
        await loadLPData(accounts[0]);
        setAccount(accounts[0]);
        setIsConnecting(false);
      }
    } catch (err) {
      setError(err.message);
      setIsConnecting(false);
    }
  };

  // 断开连接
  const disconnectWallet = () => {
    setAccount(null);
    setIsWhitelisted(false);
    setLpData(null);
  };

  // 初始加载
  useEffect(() => {
    loadFundData();
    
    // 自动检测已连接的钱包
    const checkConnectedWallet = async () => {
      if (hasWallet) {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts.length > 0) {
            setAccount(accounts[0]);
            await loadLPData(accounts[0]);
          }
        } catch (err) {
          console.error('Error checking wallet:', err);
        }
      }
    };
    checkConnectedWallet();
  }, [loadFundData, loadLPData, hasWallet]);

  // 监听账户变化
  useEffect(() => {
    if (hasWallet) {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          loadLPData(accounts[0]);
        } else {
          disconnectWallet();
        }
      });

      window.ethereum.on('chainChanged', () => {
        window.location.reload();
      });
    }
  }, [hasWallet, loadLPData]);

  // ============ 渲染 ============
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%)',
      color: '#e0e0e0',
      fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      padding: '0',
      margin: '0'
    }}>
      {/* 背景装饰 */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: `
          radial-gradient(ellipse at 20% 20%, rgba(120, 80, 255, 0.08) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 80%, rgba(0, 200, 150, 0.06) 0%, transparent 50%)
        `,
        pointerEvents: 'none',
        zIndex: 0
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '1400px', margin: '0 auto', padding: '24px' }}>
        {/* 顶部导航 */}
        <header style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '48px',
          paddingBottom: '24px',
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}>
          <div>
            <h1 style={{
              fontSize: '28px',
              fontWeight: '600',
              margin: 0,
              background: 'linear-gradient(135deg, #fff 0%, #a0a0a0 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.5px'
            }}>
              {fundData?.name || 'Fund Portal'}
            </h1>
            <p style={{ color: '#666', margin: '8px 0 0', fontSize: '14px' }}>
              LP Investment Portal
            </p>
          </div>

          {account ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                padding: '10px 16px',
                background: 'rgba(0, 200, 150, 0.1)',
                borderRadius: '12px',
                border: '1px solid rgba(0, 200, 150, 0.2)',
                fontSize: '14px'
              }}>
                <span style={{ color: '#00c896' }}>●</span>
                <span style={{ marginLeft: '8px', fontFamily: 'monospace' }}>
                  {shortenAddress(account)}
                </span>
              </div>
              <button
                onClick={disconnectWallet}
                style={{
                  padding: '10px 20px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s'
                }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              disabled={isConnecting}
              style={{
                padding: '12px 28px',
                background: 'linear-gradient(135deg, #7850ff 0%, #00c896 100%)',
                border: 'none',
                borderRadius: '12px',
                color: '#fff',
                fontWeight: '600',
                cursor: isConnecting ? 'wait' : 'pointer',
                fontSize: '15px',
                transition: 'transform 0.2s, box-shadow 0.2s',
                boxShadow: '0 4px 20px rgba(120, 80, 255, 0.3)'
              }}
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </header>

        {error && (
          <div style={{
            padding: '16px 20px',
            background: 'rgba(255, 80, 80, 0.1)',
            border: '1px solid rgba(255, 80, 80, 0.2)',
            borderRadius: '12px',
            marginBottom: '24px',
            color: '#ff6b6b'
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: '24px', marginBottom: '16px' }}>⏳</div>
            <p style={{ color: '#666' }}>Loading fund data...</p>
          </div>
        ) : (
          <>
            {/* 基金概览卡片 */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '20px',
              marginBottom: '32px'
            }}>
              {/* 净值卡片 */}
              <div style={{
                background: 'linear-gradient(135deg, rgba(120, 80, 255, 0.15) 0%, rgba(120, 80, 255, 0.05) 100%)',
                borderRadius: '20px',
                padding: '28px',
                border: '1px solid rgba(120, 80, 255, 0.2)'
              }}>
                <p style={{ color: '#888', fontSize: '13px', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Current NAV
                </p>
                <p style={{ fontSize: '42px', fontWeight: '700', margin: 0, color: '#fff' }}>
                  ${formatNumber(fundData?.currentNav, 4)}
                </p>
                <p style={{ color: fundData?.currentNav >= 1 ? '#00c896' : '#ff6b6b', fontSize: '14px', marginTop: '8px' }}>
                  {fundData?.currentNav >= 1 ? '+' : ''}{formatNumber((fundData?.currentNav - 1) * 100)}% since inception
                </p>
              </div>

              {/* 总份额 */}
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '20px',
                padding: '28px',
                border: '1px solid rgba(255,255,255,0.06)'
              }}>
                <p style={{ color: '#888', fontSize: '13px', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Total Shares
                </p>
                <p style={{ fontSize: '42px', fontWeight: '700', margin: 0, color: '#fff' }}>
                  {formatNumber(fundData?.totalShares, 0)}
                </p>
                <p style={{ color: '#666', fontSize: '14px', marginTop: '8px' }}>
                  Outstanding shares
                </p>
              </div>

              {/* 成立时间 */}
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: '20px',
                padding: '28px',
                border: '1px solid rgba(255,255,255,0.06)'
              }}>
                <p style={{ color: '#888', fontSize: '13px', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Inception Date
                </p>
                <p style={{ fontSize: '28px', fontWeight: '600', margin: 0, color: '#fff' }}>
                  {formatDate(fundData?.inceptionDate)}
                </p>
                <p style={{ color: '#666', fontSize: '14px', marginTop: '8px' }}>
                  {fundData?.inceptionDate ? Math.floor((Date.now() / 1000 - fundData.inceptionDate) / (24 * 60 * 60)) : 0} days track record
                </p>
              </div>
            </div>

            {/* 净值走势图 */}
            {navHistory.length > 1 && (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '20px',
                padding: '28px',
                border: '1px solid rgba(255,255,255,0.06)',
                marginBottom: '32px'
              }}>
                <h2 style={{ fontSize: '18px', fontWeight: '600', margin: '0 0 24px', color: '#fff' }}>
                  NAV Performance
                </h2>
                <div style={{ height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={navHistory}>
                      <defs>
                        <linearGradient id="navGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#7850ff" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#7850ff" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis 
                        dataKey="date" 
                        stroke="#444" 
                        fontSize={12}
                        tickLine={false}
                        axisLine={{ stroke: '#333' }}
                      />
                      <YAxis 
                        stroke="#444" 
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        domain={['auto', 'auto']}
                        tickFormatter={(v) => `$${v.toFixed(2)}`}
                      />
                      <Tooltip 
                        contentStyle={{
                          background: '#1a1a2e',
                          border: '1px solid #333',
                          borderRadius: '8px',
                          color: '#fff'
                        }}
                        formatter={(value) => [`$${value.toFixed(4)}`, 'NAV']}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="nav" 
                        stroke="#7850ff" 
                        strokeWidth={2}
                        fill="url(#navGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* LP个人信息（连接钱包后显示）*/}
            {account && isWhitelisted && lpData && lpData.shares > 0 && (
              <div style={{
                background: 'linear-gradient(135deg, rgba(0, 200, 150, 0.1) 0%, rgba(0, 200, 150, 0.02) 100%)',
                borderRadius: '20px',
                padding: '32px',
                border: '1px solid rgba(0, 200, 150, 0.2)',
                marginBottom: '32px'
              }}>
                <h2 style={{ fontSize: '18px', fontWeight: '600', margin: '0 0 24px', color: '#fff' }}>
                  Your Investment
                </h2>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                  gap: '24px'
                }}>
                  <div>
                    <p style={{ color: '#888', fontSize: '13px', margin: '0 0 4px' }}>Current Value</p>
                    <p style={{ fontSize: '32px', fontWeight: '700', margin: 0, color: '#00c896' }}>
                      {formatUSD(lpData.value)}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#888', fontSize: '13px', margin: '0 0 4px' }}>Your Shares</p>
                    <p style={{ fontSize: '28px', fontWeight: '600', margin: 0, color: '#fff' }}>
                      {formatNumber(lpData.shares, 0)}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#888', fontSize: '13px', margin: '0 0 4px' }}>Initial Investment</p>
                    <p style={{ fontSize: '28px', fontWeight: '600', margin: 0, color: '#fff' }}>
                      {formatUSD(lpData.initialInvestment)}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: '#888', fontSize: '13px', margin: '0 0 4px' }}>Total Return</p>
                    <p style={{ 
                      fontSize: '28px', 
                      fontWeight: '600', 
                      margin: 0, 
                      color: lpData.returnRate >= 0 ? '#00c896' : '#ff6b6b' 
                    }}>
                      {lpData.returnRate >= 0 ? '+' : ''}{formatNumber(lpData.returnRate)}%
                    </p>
                  </div>
                </div>
                <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <p style={{ color: '#666', fontSize: '13px', margin: 0 }}>
                    Investment Date: {formatDate(lpData.investmentDate)}
                  </p>
                </div>
              </div>
            )}

            {/* 未连接钱包提示 */}
            {!account && (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '20px',
                padding: '48px',
                border: '1px solid rgba(255,255,255,0.06)',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔐</div>
                <h3 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 8px', color: '#fff' }}>
                  Connect Your Wallet
                </h3>
                <p style={{ color: '#666', margin: '0 0 24px', maxWidth: '400px', marginInline: 'auto' }}>
                  Connect your whitelisted wallet to view your investment details, share balance, and performance.
                </p>
                <button
                  onClick={connectWallet}
                  style={{
                    padding: '14px 36px',
                    background: 'linear-gradient(135deg, #7850ff 0%, #00c896 100%)',
                    border: 'none',
                    borderRadius: '12px',
                    color: '#fff',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '16px'
                  }}
                >
                  Connect Wallet
                </button>
              </div>
            )}

            {/* 已连接但不在白名单 */}
            {account && !isWhitelisted && (
              <div style={{
                background: 'rgba(255, 200, 80, 0.1)',
                borderRadius: '20px',
                padding: '48px',
                border: '1px solid rgba(255, 200, 80, 0.2)',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                <h3 style={{ fontSize: '20px', fontWeight: '600', margin: '0 0 8px', color: '#fff' }}>
                  Wallet Not Whitelisted
                </h3>
                <p style={{ color: '#888', margin: 0, maxWidth: '400px', marginInline: 'auto' }}>
                  Your connected wallet ({shortenAddress(account)}) is not registered as an LP. 
                  Please contact the fund administrator if you believe this is an error.
                </p>
              </div>
            )}
          </>
        )}

        {/* 页脚 */}
        <footer style={{
          marginTop: '64px',
          paddingTop: '24px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#444',
          fontSize: '13px'
        }}>
          <div>
            <p style={{ margin: 0 }}>
              Contract: <a 
                href={`${CONFIG.blockExplorer}/address/${CONFIG.contractAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#666', fontFamily: 'monospace' }}
              >
                {shortenAddress(CONFIG.contractAddress)}
              </a>
            </p>
          </div>
          <div>
            <p style={{ margin: 0 }}>
              Network: {CONFIG.chainName}
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
