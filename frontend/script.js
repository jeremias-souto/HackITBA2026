// --- Global State ---
let provider;
let signer;
let userAddress = null;

// The deployed address of the Factory contract (needs to be replaced when deployed)
const FACTORY_ADDRESS = "0xA5915a6C8921AC373441C2ED3adF204100166Da1";
const BACKEND_API = "http://localhost:3001/api/strongbox";

// --- DOM Elements ---
const views = {
    login: document.getElementById("view-login"),
    mainMenu: document.getElementById("view-main-menu"),
    heir: document.getElementById("view-heir"),
    guardian: document.getElementById("view-guardian"),
    create: document.getElementById("view-create"),
    owner: document.getElementById("view-owner-sb")
};

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    setupNavigation();
    setupMetamask();
    setupCreateForm();
    setupOwnerDash();
    setupHeirDash();
    setupGuardianDash();
});

// --- Navigation Logic ---
function switchView(viewName) {
    Object.values(views).forEach(v => {
        v.classList.remove("active");
        v.classList.add("hidden");
    });
    views[viewName].classList.remove("hidden");
    views[viewName].classList.add("active");
}

function setupNavigation() {
    // Main Menu Buttons
    document.getElementById("btn-nav-create").onclick = () => switchView("create");
    document.getElementById("btn-nav-heir").onclick = () => switchView("heir");
    document.getElementById("btn-nav-guardian").onclick = () => switchView("guardian");
    document.getElementById("btn-nav-owner").onclick = () => {
        switchView("owner");
        loadOwnerDashboard(); // Fetch details
    };

    // Back Buttons
    document.querySelectorAll(".nav-back").forEach(btn => {
        btn.onclick = () => switchView("mainMenu");
    });

    // Logout
    document.getElementById("btn-logout").onclick = () => {
        userAddress = null;
        signer = null;
        switchView("login");
    };
}

// --- Metamask Logic ---
function setupMetamask() {
    const btnConnect = document.getElementById("btn-connect");
    const statusMsg = document.getElementById("conn-status");

    btnConnect.onclick = async () => {
        if (typeof window.ethereum === 'undefined') {
            statusMsg.textContent = "Please install MetaMask to use this dApp!";
            return;
        }

        try {
            statusMsg.textContent = "Requesting connection...";
            provider = new ethers.BrowserProvider(window.ethereum);
            await provider.send("eth_requestAccounts", []);
            signer = await provider.getSigner();
            userAddress = await signer.getAddress();

            document.getElementById("display-wallet").textContent =
                `${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;

            switchView("mainMenu");

            // Setup Account Change Listener
            window.ethereum.on('accountsChanged', handleAccountChanged);

        } catch (err) {
            console.error(err);
            statusMsg.textContent = "Connection failed or ignored.";
        }
    };
}

// Logic to execute when the active wallet changes in MetaMask
async function handleAccountChanged(accounts) {
    if (accounts.length === 0) {
        // User locked metamask or disconnected
        document.getElementById("btn-logout").click();
    } else if (accounts[0] !== userAddress) {
        userAddress = accounts[0];
        
        // Update signer globally
        signer = await provider.getSigner();

        document.getElementById("display-wallet").textContent =
                `${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;
        
        // Clear global box address context to prevent crossover leaks
        window.currentStrongBoxAddress = null;
        
        // Push user back to main menu
        switchView("mainMenu");
        
        alert("Wallet changed! Data has been cleared.");
    }
}

// --- Utilities ---
function getFactoryContract() {
    return new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
}

function getStrongBoxContract(address) {
    return new ethers.Contract(address, STRONGBOX_ABI, signer);
}

// Validation Helper
async function validateRoleViaBackend(sbAddress, expectedRole) {
    const cleanAddress = sbAddress.trim();
    const cleanUser = userAddress.trim();
    try {
        const res = await fetch(`${BACKEND_API}/validate/${cleanAddress}/${cleanUser}`);
        if(res.ok) {
            const data = await res.json();
            if (data.roles && data.roles.includes(expectedRole)) return true;
            if (data.role === expectedRole) return true;
            return false;
        }
    } catch(e) {
        console.warn("Backend validation failed, falling back to blockchain...", e);
    }
    
    // Fallback: Check Blockchain using Factory events if backend fails or 404s
    try {
        const factory = getFactoryContract();
        const filter = factory.filters.StrongBoxCreated; // (address indexed wallet, address indexed strongBox, address guardianContract, address heirContract)
        // Fetch past events to find the guardian/heir contracts for this specific sbAddress
        const events = await factory.queryFilter(filter, 0, "latest");
        const match = events.find(e => e.args[1].toLowerCase() === cleanAddress.toLowerCase());
        
        if (match) {
            if (expectedRole === "guardian") {
                const gContract = new ethers.Contract(match.args[2], GUARDIAN_ABI, signer);
                return await gContract.isGuardian(cleanUser);
            } else if (expectedRole === "heir") {
                const hContract = new ethers.Contract(match.args[3], HEIR_ABI, signer);
                return await hContract.isHeir(cleanUser);
            }
        }
    } catch (err) {
        console.error("Blockchain fallback validation error:", err);
        return false;
    }
    return false;
}

// --- 1. Create StrongBox ---
function setupCreateForm() {
    const form = document.getElementById("create-sb-form");
    const statusMsg = document.getElementById("create-msg");

    form.onsubmit = async (e) => {
        e.preventDefault();
        statusMsg.textContent = "Initiating transaction...";
        statusMsg.style.color = "var(--text-main)";

        const timeLimit = document.getElementById("f-timelimit").value;
        const g1 = document.getElementById("f-g1-address").value.trim();
        const g2 = document.getElementById("f-g2-address").value.trim();
        const h1 = document.getElementById("f-h1-address").value.trim();
        const h2 = document.getElementById("f-h2-address").value.trim();

        if (!ethers.isAddress(g1) || !ethers.isAddress(g2) || !ethers.isAddress(h1) || !ethers.isAddress(h2)) {
            statusMsg.style.color = "var(--danger)";
            statusMsg.textContent = "Error: Una o más direcciones ingresadas son inválidas.";
            return;
        }

        try {
            const factory = getFactoryContract();

            // Call smart contract
            const tx = await factory.createStrongBox(g1, g2, h1, h2, timeLimit);
            statusMsg.textContent = "Deploying Box... waiting for confirmation.";
            const receipt = await tx.wait();

            // Find event StrongBoxCreated
            let strongBoxAddress = "0x..."; 
            // For hackathon sake, we can query `getStrongBox(userAddress)`
            strongBoxAddress = await factory.getStrongBox(userAddress);

            // POST to off-chain backend to save emails and roles
            await fetch(BACKEND_API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ownerWallet: userAddress,
                    strongBoxAddress: strongBoxAddress,
                    ownerEmail: document.getElementById("f-owner-email").value,
                    guardian1Address: g1, guardian1Email: document.getElementById("f-g1-email").value,
                    guardian2Address: g2, guardian2Email: document.getElementById("f-g2-email").value,
                    heir1Address: h1, heir1Email: document.getElementById("f-h1-email").value,
                    heir2Address: h2, heir2Email: document.getElementById("f-h2-email").value,
                    timeLimit: timeLimit
                })
            });

            statusMsg.style.color = "var(--success)";
            statusMsg.textContent = `StrongBox Created! Address: ${strongBoxAddress.substring(0, 10)}...`;

            setTimeout(() => switchView("mainMenu"), 3000);
            form.reset();
        } catch (err) {
            console.error(err);
            statusMsg.style.color = "var(--danger)";
            statusMsg.textContent = "Error: " + (err.reason || err.message);
        }
    };
}

// --- 2. Owner Dashboard ---
async function loadOwnerDashboard() {
    const msg = document.getElementById("owner-msg");
    document.getElementById("sb-balance").textContent = "Loading...";
    try {
        const factory = getFactoryContract();
        const boxAddress = await factory.getStrongBox(userAddress);

        if (!boxAddress || boxAddress === "0x0000000000000000000000000000000000000000") {
            msg.textContent = "You don't have a StrongBox yet. Check active account.";
            document.getElementById("sb-balance").textContent = "0.00 ETH";
            document.getElementById("sb-address-badge").textContent = "None";
            return;
        }

        document.getElementById("sb-address-badge").textContent = `${boxAddress.substring(0, 8)}...${boxAddress.substring(38)}`;

        const strongBox = getStrongBoxContract(boxAddress);
        const balanceWei = await strongBox.getBalance();
        document.getElementById("sb-balance").textContent = parseFloat(ethers.formatEther(balanceWei)).toFixed(4) + " ETH";

        // Query backend for offchain info
        const res = await fetch(`${BACKEND_API}/owner/${userAddress}`);
        if (res.ok) {
            const data = await res.json();
            // Show off-chain data mapped
            const heirsArray = Object.values(data.heirs);
            document.getElementById("info-h1").textContent = heirsArray[0] || "Unknown";
            document.getElementById("info-h2").textContent = heirsArray[1] || "Unknown";
            document.getElementById("info-time-limit").textContent = data.timeLimit + "s";
        }

        const lastTime = await strongBox.getLastTimeUsed();
        const dateStr = new Date(Number(lastTime) * 1000).toLocaleString();
        document.getElementById("info-last-active").textContent = dateStr;

        msg.textContent = "";
        window.currentStrongBoxAddress = boxAddress;

    } catch (err) {
        msg.textContent = "Error loading info.";
        console.error(err);
    }
}

function setupOwnerDash() {
    document.getElementById("btn-get-balance").onclick = loadOwnerDashboard;

    // Deposit
    document.getElementById("btn-sb-deposit").onclick = async () => {
        if (!window.currentStrongBoxAddress) return;
        const amt = document.getElementById("dep-amount").value;
        if (!amt) return;

        try {
            const sb = getStrongBoxContract(window.currentStrongBoxAddress);
            const tx = await sb.deposit({ value: ethers.parseEther(amt) });
            await tx.wait();
            alert("Deposit successful!");
            loadOwnerDashboard();
        } catch (e) {
            console.error(e);
            alert("Deposit failed.");
        }
    };

        // withdraw
    document.getElementById("btn-sb-withdraw").onclick = async () => {
        if (!window.currentStrongBoxAddress) return;
        const amt = document.getElementById("with-amount").value;
        if (!amt) return;

        try {
            const sb = getStrongBoxContract(window.currentStrongBoxAddress);
            const tx = await sb.withdraw(ethers.parseEther(amt), userAddress);
            await tx.wait();
            alert("Withdrawal request created! Waiting for guardians.");
        } catch (e) {
            console.error(e);
            alert("Withdraw Request failed.");
        }
    };
}

// Dev utility to advance time in Local Hardhat node
window.advanceBlockTime = async (seconds) => {
    try {
        await provider.send("evm_increaseTime", [seconds]);
        await provider.send("evm_mine", []);
        alert(`Block time advanced by ${seconds} seconds in Hardhat!`);
    } catch (err) {
        console.warn("Could not advance block time (only works on local nodes):", err);
    }
};

// --- 3. Heir Dashboard ---
function setupHeirDash() {
    const btnCheck = document.getElementById("btn-check-heir");
    let timerInterval;

    btnCheck.onclick = async () => {
        const addr = document.getElementById("heir-sb-address").value.trim();
        const msg = document.getElementById("heir-msg");
        const stats = document.getElementById("heir-stats");
        if (!addr) return;

        if (!ethers.isAddress(addr)) {
            msg.style.color = "var(--danger)";
            msg.textContent = "Dirección de StrongBox inválida.";
            stats.classList.add("hidden");
            return;
        }

        stats.classList.add("hidden");
        msg.style.color = "var(--text-main)";
        msg.textContent = "Validating Heir role...";

        // JSON Backend Validation check
        const isHeir = await validateRoleViaBackend(addr, "heir");
        if(!isHeir) {
            msg.style.color = "var(--danger)";
            msg.textContent = "Permission Denied: Your connected wallet is not an Heir for this StrongBox.";
            return;
        }

        try {
            const sb = getStrongBoxContract(addr);
            // Time logic
            const lastTime = Number(await sb.getLastTimeUsed());
            const timeLimit = Number(await sb.getTimeLimit());
            const targetTime = (lastTime + timeLimit) * 1000; // ms

            stats.classList.remove("hidden");
            msg.textContent = "";

            if (timerInterval) clearInterval(timerInterval);

            timerInterval = setInterval(() => {
                const now = Date.now();
                const diff = targetTime - now;

                if (diff <= 0) {
                    clearInterval(timerInterval);
                    document.getElementById("heir-countdown").textContent = "AVAILABLE";
                    document.getElementById("heir-countdown").style.color = "var(--success)";
                    document.getElementById("btn-inherit").disabled = false;
                } else {
                    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
                    const m = Math.floor((diff / 1000 / 60) % 60);
                    const s = Math.floor((diff / 1000) % 60);
                    document.getElementById("heir-countdown").textContent = `${d}d ${h}h ${m}m ${s}s`;
                    document.getElementById("heir-countdown").style.color = "var(--accent-cyan)";
                    document.getElementById("btn-inherit").disabled = true;
                }
            }, 1000);

            // Inherit logic
            document.getElementById("btn-inherit").onclick = async () => {
                try {
                    const tx = await sb.inherit();
                    document.getElementById("heir-countdown").textContent = "Claiming...";
                    await tx.wait();
                    alert("Inheritance claimed successfully!");
                } catch (err) {
                    alert("Failed to claim: " + err.message);
                }
            };

        } catch (e) {
            console.error(e);
            msg.style.color = "var(--danger)";
            msg.textContent = "Could not fetch data. Check address or your connection.";
            stats.classList.add("hidden");
        }
    };
}

// --- 4. Guardian Dashboard ---
function setupGuardianDash() {
    const btnCheck = document.getElementById("btn-check-requests");
    const container = document.getElementById("guardian-requests");
    const msg = document.getElementById("guardian-msg");

    btnCheck.onclick = async () => {
        const addr = document.getElementById("guardian-sb-address").value.trim();
        if (!addr) return;

        if (!ethers.isAddress(addr)) {
            container.innerHTML = "";
            msg.style.color = "var(--danger)";
            msg.textContent = "Dirección de StrongBox inválida.";
            return;
        }

        container.innerHTML = "<p class='text-center'>Validating Role...</p>";
        msg.textContent = "";

        // JSON Backend Validation check
        const isGuardian = await validateRoleViaBackend(addr, "guardian");
        if(!isGuardian) {
            container.innerHTML = "";
            msg.style.color = "var(--danger)";
            msg.textContent = "Permission Denied: Your connected wallet is not a Guardian for this StrongBox.";
            return;
        }

        container.innerHTML = "<p class='text-center'>Fetching requests...</p>";
        try {
            const sb = getStrongBoxContract(addr);
            const hasPending = await sb.hasPendingWithdrawalRequest();

            if (!hasPending) {
                container.innerHTML = "<p class='text-center' style='color:var(--text-main)'>No active requests found.</p>";
                return;
            }

            const reqId = await sb.getActiveWithdrawalRequestId();
            const request = await sb.getWithdrawalRequest(reqId);

            // Render it
            const ethAmt = ethers.formatEther(request.amount);
            container.innerHTML = `
                <div class="action-card">
                    <h4>Request #${reqId}</h4>
                    <p class="mb-1">Amount: <b>${ethAmt} ETH</b></p>
                    <p class="text-sm mb-1">To: ${request.to}</p>
                    <div class="split-container">
                        <button class="split btn secondary-btn" onclick="approveReq('${addr}', ${reqId})">Approve</button>
                        <button class="split btn outline-btn" onclick="rejectReq('${addr}', ${reqId})" style="color:var(--danger); border-color:var(--danger)">Reject</button>
                    </div>
                </div>
            `;
        } catch (e) {
            console.error(e);
            container.innerHTML = "";
            msg.textContent = "Error fetching requests. Check StrongBox address on Blockchain.";
        }
    };
}

window.approveReq = async (sbAddress, reqId) => {
    try {
        const sb = getStrongBoxContract(sbAddress);
        const tx = await sb.approveWithdrawal(reqId);
        alert("Approving... please wait.");
        await tx.wait();
        alert("Approved successfully!");
        document.getElementById("btn-check-requests").click(); // Refresh
    } catch (e) { alert("Error approving: " + e.message); }
}

window.rejectReq = async (sbAddress, reqId) => {
    try {
        const sb = getStrongBoxContract(sbAddress);
        const tx = await sb.rejectWithdrawal(reqId);
        alert("Rejecting... please wait.");
        await tx.wait();
        alert("Rejected successfully!");
        document.getElementById("btn-check-requests").click(); // Refresh
    } catch (e) { alert("Error rejecting: " + e.message); }
}
