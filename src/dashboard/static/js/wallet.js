/**
 * Wallet Page — EVM/Solana wallet display, USDC balance, funding, on-chain identity
 */

registerPage('wallet', async (container) => {
  const data = await fetchAPI('wallet');

  const shortAddr = data.walletAddress ? `${data.walletAddress.slice(0, 6)}...${data.walletAddress.slice(-4)}` : '--';
  const isEVM = data.chainType !== 'solana';
  const explorerBase = isEVM ? 'https://basescan.org/address/' : 'https://solscan.io/account/';
  const explorerUrl = data.walletAddress ? explorerBase + data.walletAddress : '#';

  container.innerHTML = `
    <div class="page-header">
      <h2>Wallet & On-Chain Identity</h2>
      <p>${isEVM ? 'EVM (Base L2)' : 'Solana'} wallet</p>
    </div>

    <div class="wallet-hero">
      <div class="wallet-address-section">
        <div class="wallet-chain-badge">${isEVM ? 'Base (EVM)' : 'Solana'}</div>
        <div class="wallet-address" title="${data.walletAddress || ''}">${shortAddr}</div>
        <div class="wallet-actions">
          <button class="btn btn-sm" onclick="copyWalletAddress('${data.walletAddress || ''}')" title="Copy full address">Copy Address</button>
          <a href="${explorerUrl}" target="_blank" class="btn btn-sm" title="View on block explorer">Explorer &#8599;</a>
        </div>
      </div>
      <div class="wallet-balances">
        <div class="wallet-balance-card">
          <div class="wallet-balance-label">USDC Balance</div>
          <div class="wallet-balance-value">${data.usdcBalance > 0 ? '$' + data.usdcBalance.toFixed(2) : '$0.00'}</div>
          <div class="wallet-balance-network">${data.usdcNetwork}</div>
        </div>
        <div class="wallet-balance-card">
          <div class="wallet-balance-label">Compute Credits</div>
          <div class="wallet-balance-value">${formatCents(data.creditBalanceCents)}</div>
          <div class="wallet-balance-network">Conway Credits</div>
        </div>
      </div>
    </div>

    <div class="kpi-grid" style="margin-top:16px;">
      <div class="kpi-card"><div class="kpi-label">Total Funded</div><div class="kpi-value positive">${formatCents(data.totalFundedCents)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Spent</div><div class="kpi-value">${formatCents(data.totalSpentCents)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Funded to Agents</div><div class="kpi-value">${formatCents(data.childFundingCents)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Reputation</div><div class="kpi-value">${data.avgReputation ? data.avgReputation.toFixed(1) + '/5' : 'N/A'}</div><div class="kpi-detail">${data.reputation.length} reviews</div></div>
    </div>

    <div class="section-card" style="margin-top:16px;">
      <h3>How to Fund Your Agent</h3>
      <div class="funding-instructions">
        <div class="funding-step">
          <span class="onboard-step">1</span>
          <div>
            <strong>Send USDC to the agent's address</strong>
            <p class="cell-muted">Send USDC on ${data.usdcNetwork} to:</p>
            <code class="wallet-address-code" onclick="copyWalletAddress('${data.walletAddress || ''}')">${data.walletAddress || 'Not configured'}</code>
          </div>
        </div>
        <div class="funding-step">
          <span class="onboard-step">2</span>
          <div>
            <strong>Agent auto-converts to credits</strong>
            <p class="cell-muted">The heartbeat checks USDC balance every 5 minutes and auto-tops up credits when low.</p>
          </div>
        </div>
        <div class="funding-step">
          <span class="onboard-step">3</span>
          <div>
            <strong>Or transfer Conway credits directly</strong>
            <p class="cell-muted">Use <code>conway credits transfer ${shortAddr} &lt;amount&gt;</code> from the Conway CLI.</p>
          </div>
        </div>
      </div>
    </div>

    ${isEVM ? `
      <div class="section-card">
        <h3>Connect Browser Wallet</h3>
        <p class="section-description">Connect MetaMask or WalletConnect to fund the agent directly from your browser.</p>
        <div id="wallet-connect-section">
          <button class="btn btn-primary" onclick="connectMetaMask()">Connect MetaMask</button>
          <div id="connected-wallet-info" style="display:none; margin-top:12px;"></div>
        </div>
      </div>
    ` : `
      <div class="section-card">
        <h3>Connect Solana Wallet</h3>
        <p class="section-description">Connect Phantom to fund the agent directly from your browser.</p>
        <button class="btn btn-primary" onclick="connectPhantom()">Connect Phantom</button>
        <div id="connected-wallet-info" style="display:none; margin-top:12px;"></div>
      </div>
    `}

    ${data.registry ? `
      <div class="section-card">
        <h3>On-Chain Identity (ERC-8004)</h3>
        <div class="detail-grid">
          <div class="detail-item"><span class="detail-label">Agent ID</span><span class="detail-value mono">${data.registry.agent_id}</span></div>
          <div class="detail-item"><span class="detail-label">Agent URI</span><span class="detail-value mono">${data.registry.agent_uri}</span></div>
          <div class="detail-item"><span class="detail-label">Chain</span><span class="detail-value">${data.registry.chain}</span></div>
          <div class="detail-item"><span class="detail-label">Contract</span><span class="detail-value mono">${data.registry.contract_address?.slice(0, 10)}...</span></div>
          <div class="detail-item"><span class="detail-label">Registered</span><span class="detail-value">${timeAgo(data.registry.registered_at)}</span></div>
          <div class="detail-item"><span class="detail-label">TX Hash</span><span class="detail-value mono">${data.registry.tx_hash?.slice(0, 10)}...</span></div>
        </div>
      </div>
    ` : `
      <div class="section-card">
        <h3>On-Chain Identity</h3>
        <p class="cell-muted">Agent not registered on-chain yet. The agent can register via the <code>register_erc8004</code> tool.</p>
      </div>
    `}

    ${data.reputation.length > 0 ? `
      <div class="section-card">
        <h3>Reputation (${data.reputation.length} reviews, avg ${data.avgReputation?.toFixed(1)}/5)</h3>
        <div class="history-list">
          ${data.reputation.map(r => `
            <div class="history-item">
              <div class="activity-dot ${r.score >= 4 ? 'success' : r.score >= 3 ? 'neutral' : 'failure'}"></div>
              <div class="history-content">
                <div class="history-task">${'&#9733;'.repeat(r.score)}${'&#9734;'.repeat(5 - r.score)} from ${r.from_agent?.slice(0, 10)}...</div>
                ${r.comment ? `<div class="history-meta">${r.comment}</div>` : ''}
              </div>
              <div class="activity-time">${timeAgo(r.created_at)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div class="grid-2">
      <div class="section-card">
        <h3>Credit Transactions</h3>
        ${data.creditTransactions.length === 0 ? '<div class="empty-state"><p>No transactions yet.</p></div>' :
          `<div class="history-list">${data.creditTransactions.slice(0, 10).map(tx => {
            const isIn = tx.type === 'topup' || tx.type === 'transfer_in' || tx.type === 'credit_purchase';
            return `<div class="history-item">
              <div class="activity-dot ${isIn ? 'success' : 'neutral'}"></div>
              <div class="history-content">
                <div class="history-task"><span class="${isIn ? 'positive' : ''}">${isIn ? '+' : '-'}${formatCents(Math.abs(tx.amount_cents))}</span> <span class="cell-muted">${tx.type}</span></div>
                <div class="history-meta">${tx.description || '--'}</div>
              </div>
              <div class="tx-balance">${formatCents(tx.balance_after_cents)}</div>
            </div>`;
          }).join('')}</div>`}
      </div>
      <div class="section-card">
        <h3>On-Chain Transactions</h3>
        ${data.onchainTransactions.length === 0 ? '<div class="empty-state"><p>No on-chain transactions yet.</p></div>' :
          `<div class="history-list">${data.onchainTransactions.map(tx => `
            <div class="history-item">
              <div class="activity-dot ${tx.status === 'confirmed' ? 'success' : tx.status === 'failed' ? 'failure' : 'neutral'}"></div>
              <div class="history-content">
                <div class="history-task"><span class="outcome-badge outcome-${tx.status === 'confirmed' ? 'success' : tx.status === 'failed' ? 'failure' : 'neutral'}">${tx.status}</span> ${tx.operation}</div>
                <div class="history-meta mono">${tx.tx_hash?.slice(0, 16)}... <span class="cell-muted">${tx.chain}</span></div>
              </div>
              <div class="activity-time">${timeAgo(tx.created_at)}</div>
            </div>
          `).join('')}</div>`}
      </div>
    </div>
  `;
});

// ─── Wallet Connect (MetaMask / EVM) ────────────────────────

async function connectMetaMask() {
  if (typeof window.ethereum === 'undefined') {
    showToast('MetaMask not detected. Install MetaMask browser extension.', 'error');
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const userAddress = accounts[0];

    // Get USDC balance on Base (chainId 8453)
    let usdcBalance = '—';
    try {
      // Switch to Base if needed
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x2105' }], // 8453 in hex
      });

      // USDC contract on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
      const balanceHex = await window.ethereum.request({
        method: 'eth_call',
        params: [{
          to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          data: '0x70a08231000000000000000000000000' + userAddress.slice(2),
        }, 'latest'],
      });
      const balanceWei = parseInt(balanceHex, 16);
      usdcBalance = '$' + (balanceWei / 1e6).toFixed(2);
    } catch (e) {
      usdcBalance = 'Could not fetch';
    }

    const infoEl = document.getElementById('connected-wallet-info');
    if (infoEl) {
      infoEl.style.display = 'block';
      infoEl.innerHTML = `
        <div class="detail-grid">
          <div class="detail-item"><span class="detail-label">Connected</span><span class="detail-value mono">${userAddress.slice(0, 6)}...${userAddress.slice(-4)}</span></div>
          <div class="detail-item"><span class="detail-label">USDC (Base)</span><span class="detail-value">${usdcBalance}</span></div>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="sendUSDCToAgent('${userAddress}')">Send USDC to Agent</button>
      `;
    }

    showToast(`Wallet connected: ${userAddress.slice(0, 8)}...`, 'success');
  } catch (e) {
    showToast('Wallet connection failed: ' + (e.message || 'User rejected'), 'error');
  }
}

async function sendUSDCToAgent(fromAddress) {
  const amount = prompt('Amount of USDC to send to the agent:');
  if (!amount || isNaN(parseFloat(amount))) return;

  const walletData = await fetchAPI('wallet');
  const agentAddress = walletData.walletAddress;
  if (!agentAddress) { showToast('Agent wallet address not found', 'error'); return; }

  try {
    const amountWei = '0x' + (Math.round(parseFloat(amount) * 1e6)).toString(16);
    // Encode ERC-20 transfer(address,uint256)
    const data = '0xa9059cbb' +
      agentAddress.slice(2).padStart(64, '0') +
      amountWei.slice(2).padStart(64, '0');

    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{
        from: fromAddress,
        to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
        data: data,
      }],
    });

    showToast(`USDC sent! TX: ${txHash.slice(0, 16)}...`, 'success');
  } catch (e) {
    showToast('Transaction failed: ' + (e.message || 'User rejected'), 'error');
  }
}

// ─── Wallet Connect (Phantom / Solana) ──────────────────────

async function connectPhantom() {
  if (!window.solana || !window.solana.isPhantom) {
    showToast('Phantom not detected. Install Phantom browser extension.', 'error');
    return;
  }

  try {
    const resp = await window.solana.connect();
    const pubKey = resp.publicKey.toString();

    const infoEl = document.getElementById('connected-wallet-info');
    if (infoEl) {
      infoEl.style.display = 'block';
      infoEl.innerHTML = `
        <div class="detail-grid">
          <div class="detail-item"><span class="detail-label">Connected</span><span class="detail-value mono">${pubKey.slice(0, 6)}...${pubKey.slice(-4)}</span></div>
        </div>
        <p class="cell-muted" style="margin-top:8px;">To fund: send USDC (SPL) to the agent's Solana address.</p>
      `;
    }

    showToast(`Phantom connected: ${pubKey.slice(0, 8)}...`, 'success');
  } catch (e) {
    showToast('Phantom connection failed', 'error');
  }
}

async function copyWalletAddress(addr) {
  if (!addr) { showToast('No wallet address', 'error'); return; }
  await navigator.clipboard.writeText(addr);
  showToast('Address copied!', 'success');
}
