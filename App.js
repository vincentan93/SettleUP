import React, { useState, useEffect, useContext, createContext, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    onAuthStateChanged, 
    signOut,
    GoogleAuthProvider,
    signInWithPopup
} from 'firebase/auth';
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    collection, 
    addDoc, 
    query, 
    where, 
    onSnapshot,
    serverTimestamp,
    getDocs,
    Timestamp,
    updateDoc,
    deleteDoc,
    writeBatch,
    arrayUnion,
    orderBy
} from 'firebase/firestore';

// --- App Constants ---
const CATEGORIES = ["Hotel", "Flight", "Food and Beverage", "Transport", "Entertainment", "Misc"];
const CURRENCIES = ["USD", "EUR", "JPY", "GBP", "AUD", "CAD", "CHF", "CNY", "SGD", "MYR"];
const PLACEHOLDER_RATES = { USD: 1, EUR: 0.93, JPY: 157, GBP: 0.79, AUD: 1.50, CAD: 1.37, CHF: 0.90, CNY: 7.25, SGD: 1.35, MYR: 4.71 };


// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyDVfoFR4dOeqYIPIPaJr8JoewIjN7HAQR0",
  authDomain: "weshare-53d76.firebaseapp.com",
  projectId: "weshare-53d76",
  storageBucket: "weshare-53d76.appspot.com",
  messagingSenderId: "242700002052",
  appId: "1:242700002052:web:8ff1fbff92b0d2ce32a651"
};

// --- 1. Create Firebase Context ---
const FirebaseContext = createContext(null);
const useFirebase = () => useContext(FirebaseContext);

// --- 2. Create a Firebase Provider Component ---
const FirebaseProvider = ({ children }) => {
    const [firebase, setFirebase] = useState({
        app: null,
        auth: null,
        db: null,
        error: null,
        loading: true,
    });

    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            const db = getFirestore(app);
            setFirebase({ app, auth, db, error: null, loading: false });
        } catch (error) {
            console.error("FATAL: Firebase initialization failed.", error);
            setFirebase({ app: null, auth: null, db: null, error: `Firebase initialization failed: ${error.message}`, loading: false });
        }
    }, []);

    return (
        <FirebaseContext.Provider value={firebase}>
            {children}
        </FirebaseContext.Provider>
    );
};

// --- Helper Functions ---
const getUsername = async (db, userId) => {
    if (!userId || !db) return 'Unknown';
    try {
        const userDocRef = doc(db, "users", userId);
        const userDoc = await getDoc(userDocRef);
        return userDoc.exists() ? userDoc.data().username : 'Unknown';
    } catch (error) {
        console.error(`Error getting username for UID ${userId}:`, error);
        return 'Error';
    }
};

const getUsernames = async (db, userIds) => {
    if (!userIds || userIds.length === 0 || !db) return [];
    try {
        const userDocs = await Promise.all(userIds.map(id => getDoc(doc(db, 'users', id))));
        return userDocs.map(doc => doc.exists() ? { id: doc.id, ...doc.data() } : { id: doc.id, username: 'Unknown' });
    } catch (error) {
        console.error("Error fetching usernames:", error);
        return userIds.map(id => ({ id, username: 'Error' }));
    }
};

const convertCurrency = (amount, from, to) => {
    const fromRate = PLACEHOLDER_RATES[from] || 1;
    const toRate = PLACEHOLDER_RATES[to] || 1;
    const amountInUSD = amount / fromRate;
    return amountInUSD * toRate;
};

// --- Main Application Logic ---
const AppLogic = () => {
    const { auth, db, error: firebaseError, loading: firebaseLoading } = useFirebase();
    const [user, setUser] = useState(null);
    const [username, setUsername] = useState(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState(null);
    const [projects, setProjects] = useState([]);
    const [currentProject, setCurrentProject] = useState(null);
    const [expenses, setExpenses] = useState([]);
    const [notifications, setNotifications] = useState([]);
    const [showAddProjectModal, setShowAddProjectModal] = useState(false);
    const [projectToEdit, setProjectToEdit] = useState(null);
    const [projectToDelete, setProjectToDelete] = useState(null);
    const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
    const [editingExpenseGroup, setEditingExpenseGroup] = useState(null);
    const [expenseToDelete, setExpenseToDelete] = useState(null);
    const [view, setView] = useState('dashboard');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [showAccountModal, setShowAccountModal] = useState(false);
    const [showNotificationsModal, setShowNotificationsModal] = useState(false);
    const [joinTripInfo, setJoinTripInfo] = useState(null);


    useEffect(() => {
        if (firebaseLoading || firebaseError) return;
        
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                try {
                    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
                    if (userDoc.exists()) {
                        setUsername(userDoc.data().username);
                    } else {
                         setUsername(null);
                    }
                    setUser(currentUser);
                } catch (error) {
                    setAuthError(`Permission error fetching user profile: ${error.message}`);
                }
            } else {
                setUser(null);
                setUsername(null);
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, [auth, db, firebaseLoading, firebaseError]);

    useEffect(() => {
        if (!user || !username || !db) return;
        const projectsQuery = query(collection(db, "projects"), where("members", "array-contains", user.uid));
        const unsubscribe = onSnapshot(projectsQuery, (snapshot) => {
            const userProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const sortedProjects = [...userProjects].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setProjects(sortedProjects);
            if (!currentProject && sortedProjects.length > 0) {
                setCurrentProject(sortedProjects[0]);
            } else if (currentProject && !sortedProjects.find(p => p.id === currentProject.id)) {
                setCurrentProject(sortedProjects.length > 0 ? sortedProjects[0] : null);
            }
        }, (error) => {
            console.error("Error fetching projects:", error);
        });
        return () => unsubscribe();
    }, [user, username, db, currentProject]);
    
    useEffect(() => {
        setView('dashboard');
    }, [currentProject]);

    useEffect(() => {
        if (!currentProject || !db) {
            setExpenses([]);
            return;
        }
        const expensesQuery = query(collection(db, "projects", currentProject.id, "expenses"));
        const unsubscribe = onSnapshot(expensesQuery, async (snapshot) => {
             const expensesData = await Promise.all(snapshot.docs.map(async docSnapshot => {
                const data = docSnapshot.data();
                const payeeUsername = await getUsername(db, data.payeeId);
                const payerUsernames = await Promise.all((data.payers || []).map(uid => getUsername(db, uid)));
                return { id: docSnapshot.id, ...data, payeeUsername, payerUsernames };
            }));
            setExpenses(expensesData);
        }, (error) => {
            console.error("Error fetching expenses:", error);
        });
        return () => unsubscribe();
    }, [currentProject, db]);

     // Listen for notifications
    useEffect(() => {
        if (!user || !db) return;
        const q = query(collection(db, "notifications"), where("userId", "==", user.uid), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const userNotifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setNotifications(userNotifications);
        });
        return () => unsubscribe();
    }, [user, db]);


    // Handle incoming trip invitation links
    useEffect(() => {
        if (!user || !db) return;
        const params = new URLSearchParams(window.location.search);
        const tripId = params.get('trip');
        if (tripId) {
            const checkAndJoinTrip = async () => {
                const projectRef = doc(db, 'projects', tripId);
                const projectDoc = await getDoc(projectRef);
                if (projectDoc.exists()) {
                    const projectData = projectDoc.data();
                    if (!projectData.members.includes(user.uid)) {
                        setJoinTripInfo({ id: tripId, name: projectData.name });
                    }
                }
            };
            checkAndJoinTrip();
        }
    }, [user, db]);

     const handleJoinTrip = async () => {
        if (!joinTripInfo || !user || !db) return;
        const projectRef = doc(db, 'projects', joinTripInfo.id);
        await updateDoc(projectRef, {
            members: arrayUnion(user.uid)
        });
        setJoinTripInfo(null);
        // Maybe switch to the newly joined trip
        const newProjectDoc = await getDoc(projectRef);
        setCurrentProject({id: newProjectDoc.id, ...newProjectDoc.data()});
        
        // Clean up URL
        window.history.pushState({}, '', window.location.pathname);
    };


    const handleGoogleSignIn = async () => {
        if (!auth) return;
        const provider = new GoogleAuthProvider();
         try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            setAuthError(`Sign-in failed. Details: ${error.message}`);
        }
    };
    
    const handleLogout = () => { if (auth) signOut(auth); };

    const confirmDeleteExpense = async () => {
        if (!expenseToDelete || !currentProject || !db) return;
        try {
            const batch = writeBatch(db);
            expenseToDelete.forEach(expense => {
                const expenseRef = doc(db, "projects", currentProject.id, "expenses", expense.id);
                batch.delete(expenseRef);
            });
            await batch.commit();
            setExpenseToDelete(null);
        } catch (error) {
            console.error("Error deleting expense:", error);
            alert(`Failed to delete expense: ${error.message}`);
        }
    };

    const confirmDeleteProject = async () => {
        if (!projectToDelete || !db) return;
        try {
            await deleteDoc(doc(db, "projects", projectToDelete.id));
            setProjectToDelete(null);
            if(currentProject?.id === projectToDelete.id) {
                setCurrentProject(null);
            }
        } catch (error) {
             console.error("Error deleting project:", error);
            alert(`Failed to delete project: ${error.message}`);
        }
    };

    if (loading || firebaseLoading) {
        return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Loading...</div>;
    }
    
    const finalError = authError || firebaseError;
    if (finalError) {
        return (
             <div className="min-h-screen bg-red-900 text-white flex items-center justify-center p-4">
                <div className="text-center">
                    <h1 className="text-2xl font-bold mb-2">Application Error</h1>
                    <pre className="bg-red-800 p-4 rounded text-left text-sm">{finalError}</pre>
                </div>
            </div>
        );
    }
    
    if (!user) {
        return <LoginScreen onGoogleSignIn={handleGoogleSignIn} />;
    }

    if (!username) {
        return <UsernameSetup user={user} onUsernameSet={setUsername} db={db} />;
    }
    
    return (
        <div className="flex h-screen bg-gray-900 text-white">
            <Sidebar {...{projects, setCurrentProject, currentProjectId: currentProject?.id, onAddProject: () => setShowAddProjectModal(true), onEditProject: setProjectToEdit, onDeleteProject: setProjectToDelete, username, onLogout: handleLogout, isOpen: isSidebarOpen, setIsOpen: setIsSidebarOpen, onShowNotifications: () => setShowNotificationsModal(true), hasUnreadNotifications: notifications.some(n => !n.read) }} />
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto pb-20 sm:pb-0">
                    {view === 'dashboard' ? (
                        <DashboardContent {...{project: currentProject, expenses, db, onAddExpense: () => setShowAddExpenseModal(true), onEditProject: setProjectToEdit, onEditExpense: setEditingExpenseGroup, onDeleteExpense: setExpenseToDelete, onSwitchView: setView }} />
                    ) : (
                        <ReportPage {...{project: currentProject, expenses, db, onSwitchView: setView }} />
                    )}
                </div>
                 <BottomNavBar 
                    onAddExpense={() => setShowAddExpenseModal(true)}
                    onShowAccount={() => setShowAccountModal(true)}
                    onShowTrips={() => setIsSidebarOpen(true)}
                    onShowReport={() => setView('report')}
                    onShowNotifications={() => setShowNotificationsModal(true)}
                    hasUnreadNotifications={notifications.some(n => !n.read)}
                />
            </div>

            {showAddProjectModal && <AddProjectModal {...{userId: user.uid, db, onClose: () => setShowAddProjectModal(false)}} />}
            {projectToEdit && <EditProjectModal {...{project: projectToEdit, userId: user.uid, db, onClose: () => setProjectToEdit(null), onDeleteProject: () => {setProjectToDelete(projectToEdit); setProjectToEdit(null);}}} />}
            {projectToDelete && <ConfirmModal title="Delete Trip" message={`Are you sure you want to delete "${projectToDelete.name}"? This will delete all its expenses and cannot be undone.`} onConfirm={confirmDeleteProject} onCancel={() => setProjectToDelete(null)} />}
            {showAddExpenseModal && currentProject && <AddExpenseModal {...{project: currentProject, userId: user.uid, db, onClose: () => setShowAddExpenseModal(false)}} />}
            {editingExpenseGroup && <EditExpenseModal {...{expenseGroup: editingExpenseGroup, project: currentProject, userId: user.uid, db, onClose: () => setEditingExpenseGroup(null)}} />}
            {expenseToDelete && (
                <ConfirmModal
                    title="Delete Expense"
                    message="Are you sure you want to delete this transaction? This action cannot be undone."
                    onConfirm={confirmDeleteExpense}
                    onCancel={() => setExpenseToDelete(null)}
                />
            )}
            {showAccountModal && <AccountModal user={user} username={username} onLogout={handleLogout} onClose={() => setShowAccountModal(false)} />}
            {showNotificationsModal && <NotificationsModal notifications={notifications} db={db} onClose={() => setShowNotificationsModal(false)} setCurrentProject={setCurrentProject} projects={projects} />}
            {joinTripInfo && <ConfirmModal title="Join Trip" message={`Do you want to join the trip "${joinTripInfo.name}"?`} onConfirm={handleJoinTrip} onCancel={() => setJoinTripInfo(null)} />}
        </div>
    );
};

// --- Chart Components using Chart.js ---
const PieChartComponent = ({ data, currency }) => {
    const chartRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const [isPluginLoaded, setIsPluginLoaded] = useState(false);

    useEffect(() => {
        const loadScripts = () => {
            const chartJsLoaded = !!window.Chart;
            if (!chartJsLoaded) {
                const chartScript = document.createElement('script');
                chartScript.src = 'https://cdn.jsdelivr.net/npm/chart.js';
                chartScript.async = true;
                chartScript.onload = loadDataLabelsScript;
                document.body.appendChild(chartScript);
            } else {
                loadDataLabelsScript();
            }
        };

        const loadDataLabelsScript = () => {
            if (window.ChartDataLabels) {
                 if (!window.Chart.registry.plugins.get('datalabels')) {
                    window.Chart.register(window.ChartDataLabels);
                }
                setIsPluginLoaded(true);
                return;
            }
            const pluginScript = document.createElement('script');
            pluginScript.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0';
            pluginScript.async = true;
            pluginScript.onload = () => {
                if(window.Chart && window.ChartDataLabels) {
                     if (!window.Chart.registry.plugins.get('datalabels')) {
                        window.Chart.register(window.ChartDataLabels);
                    }
                    setIsPluginLoaded(true);
                }
            };
            document.body.appendChild(pluginScript);
        };
        
        loadScripts();
    }, []);

    useEffect(() => {
        if (!isPluginLoaded || !chartRef.current || !data.length) return;
        if (chartInstanceRef.current) chartInstanceRef.current.destroy();

        const ctx = chartRef.current.getContext('2d');
        chartInstanceRef.current = new window.Chart(ctx, {
            type: 'pie',
            data: {
                labels: data.map(d => d.name),
                datasets: [{
                    data: data.map(d => d.value),
                    backgroundColor: ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#FF1943', '#19B2FF'],
                    borderColor: '#1f2937', borderWidth: 2,
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { 
                    legend: { position: 'top', labels: { color: '#e5e7eb', font: { size: 14, weight: 'bold' } } }, 
                    tooltip: { enabled: false },
                    datalabels: {
                        color: '#fff',
                        font: {
                            weight: 'bold',
                            size: 14,
                        },
                        formatter: (value) => {
                             return new Intl.NumberFormat('en-US', { currency: currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
                        }
                    }
                } 
            }
        });
        return () => { if (chartInstanceRef.current) chartInstanceRef.current.destroy(); };
    }, [data, isPluginLoaded, currency]);

    if (!isPluginLoaded) return <div className="h-64 flex items-center justify-center"><p className="text-gray-400">Loading chart...</p></div>;
    return <div className="relative h-64 md:h-80"><canvas ref={chartRef}></canvas></div>;
};

const BarChartComponent = ({ data, currency }) => {
    const chartRef = useRef(null);
    const chartInstanceRef = useRef(null);
    const [isPluginLoaded, setIsPluginLoaded] = useState(false);

    useEffect(() => {
        const loadScripts = () => {
            const chartJsLoaded = !!window.Chart;
            if (!chartJsLoaded) {
                const chartScript = document.createElement('script');
                chartScript.src = 'https://cdn.jsdelivr.net/npm/chart.js';
                chartScript.async = true;
                chartScript.onload = loadDataLabelsScript;
                document.body.appendChild(chartScript);
            } else {
                loadDataLabelsScript();
            }
        };

        const loadDataLabelsScript = () => {
            if (window.ChartDataLabels) {
                 if (!window.Chart.registry.plugins.get('datalabels')) {
                    window.Chart.register(window.ChartDataLabels);
                }
                setIsPluginLoaded(true);
                return;
            }
            const pluginScript = document.createElement('script');
            pluginScript.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.0.0';
            pluginScript.async = true;
            pluginScript.onload = () => {
                if(window.Chart && window.ChartDataLabels) {
                     if (!window.Chart.registry.plugins.get('datalabels')) {
                        window.Chart.register(window.ChartDataLabels);
                    }
                    setIsPluginLoaded(true);
                }
            };
            document.body.appendChild(pluginScript);
        };
        
        loadScripts();
    }, []);

    useEffect(() => {
        if (!isPluginLoaded || !chartRef.current || !data.length) return;
        if (chartInstanceRef.current) chartInstanceRef.current.destroy();
        
        const ctx = chartRef.current.getContext('2d');
        chartInstanceRef.current = new window.Chart(ctx, {
            type: 'bar',
            data: { labels: data.map(d => d.name), datasets: [{ label: 'Total Spent', data: data.map(d => d.value), backgroundColor: 'rgba(0, 136, 254, 0.5)', borderColor: '#0088FE', borderWidth: 1 }] },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                scales: { x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }, y: { beginAtZero: true, ticks: { color: '#9ca3af' }, grid: { color: '#374151' } } }, 
                plugins: { 
                    legend: { display: false }, 
                    tooltip: { enabled: false },
                    datalabels: {
                        anchor: 'end',
                        align: 'top',
                        color: '#e5e7eb',
                        font: {
                            weight: 'bold',
                            size: 14,
                        },
                        formatter: (value) => {
                            return new Intl.NumberFormat('en-US', { currency: currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
                        }
                    }
                } 
            }
        });
        return () => { if (chartInstanceRef.current) chartInstanceRef.current.destroy(); };
    }, [data, isPluginLoaded, currency]);
    
    if (!isPluginLoaded) return <div className="h-64 flex items-center justify-center"><p className="text-gray-400">Loading chart...</p></div>;
    return <div className="relative h-64 md:h-80"><canvas ref={chartRef}></canvas></div>;
};


// --- UI Components ---
const LoginScreen = ({ onGoogleSignIn }) => (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
        <div className="text-center bg-gray-800 p-8 sm:p-12 rounded-lg shadow-xl max-w-md w-full">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">SettleUp</h1>
            <p className="text-gray-400 mb-8">Sign in to manage your group expenses.</p>
            <button onClick={onGoogleSignIn} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg flex items-center justify-center transition duration-300">
                <svg className="w-6 h-6 mr-3" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571l6.19,5.238C41.38,36.101,44,30.655,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path></svg>
                Sign in with Google
            </button>
        </div>
    </div>
);

const UsernameSetup = ({ user, onUsernameSet, db }) => {
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleUsernameSubmit = async (e) => {
        e.preventDefault();
        if (!username.trim() || username.length < 3) { setError('Username must be at least 3 characters.'); return; }
        setLoading(true); setError('');
        try {
            const usernameQuery = query(collection(db, "users"), where("username", "==", username.trim()));
            const querySnapshot = await getDocs(usernameQuery);
            if (!querySnapshot.empty) { setError('This username is already taken.'); setLoading(false); return; }
            await setDoc(doc(db, "users", user.uid), { email: user.email, username: username.trim(), createdAt: serverTimestamp() });
            onUsernameSet(username.trim());
        } catch (err) {
            setError(`Failed to set username: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-4">
            <div className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md">
                <h2 className="text-2xl font-bold mb-4 text-center">Create Your Username</h2>
                <form onSubmit={handleUsernameSubmit}>
                    <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Enter desired username" className="w-full p-3 bg-gray-700 rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4" />
                    {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                    <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-md transition duration-300 disabled:bg-blue-400">
                        {loading ? 'Saving...' : 'Set Username'}
                    </button>
                </form>
            </div>
        </div>
    );
};

const Sidebar = ({ projects, setCurrentProject, currentProjectId, onAddProject, onEditProject, onDeleteProject, username, onLogout, isOpen, setIsOpen }) => {

    const TripList = () => (
         <nav className="flex-grow overflow-y-auto">
            <ul>
                {projects.map(p => (
                     <li key={p.id} className={`p-2 rounded-md cursor-pointer mb-2 flex justify-between items-center group ${p.id === currentProjectId ? 'bg-blue-600' : 'hover:bg-gray-700'}`} onClick={() => { setCurrentProject(p); if (setIsOpen) setIsOpen(false); }}>
                        <span className="truncate">{p.name}</span>
                    </li>
                ))}
            </ul>
        </nav>
    );

    return(
    <>
        {/* Mobile Sidebar */}
        <div className={`fixed inset-0 z-40 transform transition-transform sm:hidden ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
             <div className="absolute inset-0 bg-black opacity-50" onClick={() => setIsOpen(false)}></div>
             <div className="relative w-64 bg-gray-800 h-full p-4 flex flex-col">
                <h2 className="text-3xl font-bold mb-8 px-2">SettleUp</h2>
                <TripList />
                <div className="mt-auto pt-4 border-t border-gray-700">
                     <button onClick={() => {onAddProject(); setIsOpen(false);}} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md mb-4">
                        New Trip
                    </button>
                </div>
            </div>
        </div>

         {/* Desktop Sidebar */}
        <div className="w-64 bg-gray-800 p-4 flex-col hidden sm:flex">
            <h2 className="text-3xl font-bold mb-8 px-2">SettleUp</h2>
            <TripList />
            <div className="mt-auto pt-4 border-t border-gray-700">
                 <button onClick={onAddProject} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md mb-4">
                    New Trip
                </button>
                 <div className="text-sm text-gray-400 border-t border-gray-700 pt-4">
                    <p>Signed in as:</p>
                    <p className="font-bold truncate">{username}</p>
                    <button onClick={onLogout} className="text-red-500 hover:text-red-400 mt-2 w-full text-left text-sm">Logout</button>
                </div>
            </div>
        </div>
    </>
    );
};

const DashboardContent = ({ project, expenses, db, onAddExpense, onEditProject, onEditExpense, onDeleteExpense, onSwitchView }) => {
    const [displayCurrency, setDisplayCurrency] = useState(project?.defaultCurrency || 'USD');
    const [membersData, setMembersData] = useState([]);

    useEffect(() => {
        if (project) {
            setDisplayCurrency(project.defaultCurrency || 'USD');
            getUsernames(db, project.members).then(setMembersData);
        }
    }, [project, db]);
    
    if (!project) {
        return (
            <div className="flex-1 p-4 sm:p-8 flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl sm:text-2xl font-semibold text-gray-400">No trip selected.</h2>
                    <p className="text-gray-500 mt-2">Select a trip from the sidebar or add a new one.</p>
                </div>
            </div>
        );
    }

    const groupedExpenses = expenses.reduce((acc, expense) => {
        const groupId = expense.transactionGroupId || expense.id;
        if (!acc[groupId]) {
            acc[groupId] = [];
        }
        acc[groupId].push(expense);
        return acc;
    }, {});
    
    const recentTransactionGroups = Object.values(groupedExpenses).sort((a,b) => (b[0].expenseDate?.seconds || 0) - (a[0].expenseDate?.seconds || 0));

    const convertedExpenses = expenses.map(e => ({
        ...e,
        amount: convertCurrency(e.amount, e.currency, displayCurrency)
    }));

    const spendingByPayee = convertedExpenses.reduce((acc, expense) => { const user = expense.payeeUsername || 'Unknown'; if (!acc[user]) acc[user] = 0; acc[user] += expense.amount; return acc; }, {});
    const spendingByCategory = convertedExpenses.reduce((acc, expense) => { const category = expense.category || 'Misc'; if (!acc[category]) acc[category] = 0; acc[category] += expense.amount; return acc; }, {});
    const spendingByDay = convertedExpenses.reduce((acc, expense) => { if (!expense.expenseDate) return acc; const date = expense.expenseDate.toDate().toISOString().split('T')[0]; if (!acc[date]) acc[date] = 0; acc[date] += expense.amount; return acc; }, {});
    
    const spendingByPayerShare = convertedExpenses.reduce((acc, expense) => {
        const costPerPerson = expense.amount / (expense.payers?.length || 1);
        expense.payers?.forEach(payerId => {
            const member = membersData.find(m => m.id === payerId);
            const username = member ? member.username : 'Unknown';
            if (!acc[username]) acc[username] = 0;
            acc[username] += costPerPerson;
        });
        return acc;
    }, {});


    const chartDataByPayee = Object.keys(spendingByPayee).map(name => ({ name, value: spendingByPayee[name] }));
    const chartDataByCategory = Object.keys(spendingByCategory).map(name => ({ name, value: spendingByCategory[name] }));
    const chartDataByDay = Object.keys(spendingByDay).sort().map(date => ({ name: new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), value: spendingByDay[date] }));
    const chartDataByPayerShare = Object.keys(spendingByPayerShare).map(name => ({ name, value: spendingByPayerShare[name] }));
    
    const pieCharts = [
        { title: `Spending by Payee (${displayCurrency})`, component: <PieChartComponent data={chartDataByPayee} currency={displayCurrency} /> },
        { title: `Spending by Payer (${displayCurrency})`, component: <PieChartComponent data={chartDataByPayerShare} currency={displayCurrency} /> },
        { title: `Spending by Category (${displayCurrency})`, component: <PieChartComponent data={chartDataByCategory} currency={displayCurrency} /> }
    ];

    return (
        <main className="flex-1 p-4 sm:p-8 overflow-y-auto">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
                <h1 className="text-2xl sm:text-3xl font-bold truncate">{project.name}</h1>
                 <div className="flex items-center space-x-2 w-full sm:w-auto">
                    <button onClick={() => onEditProject(project)} className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-md text-sm h-10 flex-1 sm:flex-none">Edit Trip</button>
                    <select value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value)} className="bg-gray-700 p-2 rounded-md border border-gray-600 flex-grow h-10">
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => onSwitchView('report')} className="hidden sm:inline-flex bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md h-10">Report</button>
                    <button onClick={onAddExpense} className="hidden sm:inline-flex bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md h-10 whitespace-nowrap">Add Expense</button>
                 </div>
            </div>
            
            <div className="bg-gray-800 p-4 sm:p-6 rounded-lg mb-8">
                <h2 className="text-xl font-semibold mb-4">Spending by Day ({displayCurrency})</h2>
                {expenses.length > 0 ? <BarChartComponent data={chartDataByDay} currency={displayCurrency} /> : <p className="text-gray-400">No expenses recorded yet.</p>}
            </div>

            {/* Desktop Chart Grid */}
            <div className="hidden lg:grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                 {pieCharts.map(chart => (
                    <div key={chart.title} className="bg-gray-800 p-4 sm:p-6 rounded-lg">
                        <h2 className="text-xl font-semibold mb-4">{chart.title}</h2>
                        {expenses.length > 0 ? chart.component : <p className="text-gray-400">No expenses recorded yet.</p>}
                    </div>
                ))}
            </div>

             {/* Mobile Chart Carousel */}
            <div className="lg:hidden mb-8">
                <ChartCarousel charts={pieCharts} />
            </div>

            <div>
                <h2 className="text-xl font-semibold mb-4">Recent Transactions</h2>
                <div className="bg-gray-800 rounded-lg">
                    <ul className="divide-y divide-gray-700">
                        {recentTransactionGroups.slice(0, 10).map(group => {
                            const firstExpense = group[0];
                            const totalConvertedAmount = group.reduce((sum, exp) => sum + convertCurrency(exp.amount, exp.currency, displayCurrency), 0);
                            const payeeUsernames = [...new Set(group.map(exp => exp.payeeUsername))].join(', ');

                            return (
                                <li key={firstExpense.transactionGroupId || firstExpense.id} className="flex justify-between items-center p-3 group">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold truncate">{firstExpense.description}</p>
                                        <p className="text-sm text-gray-400 truncate">Payees: {payeeUsernames} <span className="hidden sm:inline text-gray-500">• {firstExpense.category || 'Misc'}</span></p>
                                    </div>
                                    <div className="text-right ml-4 flex-shrink-0">
                                        <p className="font-bold text-lg whitespace-nowrap">{totalConvertedAmount.toFixed(2)} {displayCurrency}</p>
                                        <p className="text-xs text-gray-500">{firstExpense.expenseDate ? new Date(firstExpense.expenseDate.seconds * 1000).toLocaleDateString() : ''}</p>
                                    </div>
                                     <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                        <button onClick={() => onEditExpense(group)} className="text-blue-400 hover:text-blue-300 p-1"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg></button>
                                        <button onClick={() => onDeleteExpense(group)} className="text-red-500 hover:text-red-400 p-1"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg></button>
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                </div>
            </div>
        </main>
    );
};

const ReportPage = ({ project, expenses, db, onSwitchView }) => {
    const [displayCurrency, setDisplayCurrency] = useState(project.defaultCurrency || 'USD');
    const [summary, setSummary] = useState([]);
    const [filters, setFilters] = useState({ startDate: '', endDate: '', payeeId: 'all', category: 'all', payerId: 'all' });
    const [membersData, setMembersData] = useState([]);
    const [showFilters, setShowFilters] = useState(false);

    useEffect(() => {
        if(project.members) {
            getUsernames(db, project.members).then(setMembersData);
        }
    }, [project.members, db])
    
    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const resetFilters = () => {
        setFilters({ startDate: '', endDate: '', payeeId: 'all', category: 'all', payerId: 'all' });
    };

    const filteredExpenses = expenses.filter(expense => {
        if (filters.payeeId !== 'all' && expense.payeeId !== filters.payeeId) return false;
        if (filters.category !== 'all' && expense.category !== filters.category) return false;
        if (filters.payerId !== 'all' && !expense.payers.includes(filters.payerId)) return false;
        if(filters.startDate && expense.expenseDate.toDate() < new Date(filters.startDate)) return false;
        if(filters.endDate && expense.expenseDate.toDate() > new Date(filters.endDate)) return false;
        return true;
    });


    useEffect(() => {
        const calculateSummary = async () => {
            if (!project.members || filteredExpenses.length === 0) {
                setSummary([]);
                return;
            }
            
            const balances = membersData.reduce((acc, member) => {
                acc[member.id] = { username: member.username, totalPaid: 0, totalOwed: 0 };
                return acc;
            }, {});

            filteredExpenses.forEach(expense => {
                const convertedAmount = convertCurrency(expense.amount, expense.currency, displayCurrency);
                const shareCount = expense.payers?.length || 1;
                const costPerPerson = convertedAmount / shareCount;
                
                if (balances[expense.payeeId]) {
                    balances[expense.payeeId].totalPaid += convertedAmount;
                }
                
                expense.payers?.forEach(memberId => {
                    if (balances[memberId]) {
                        balances[memberId].totalOwed += costPerPerson;
                    }
                });
            });

            const summaryData = Object.values(balances).map(b => ({
                ...b,
                netBalance: b.totalPaid - b.totalOwed,
            }));

            setSummary(summaryData);
        };

        calculateSummary();
    }, [filteredExpenses, displayCurrency, project.members, db, membersData]);

    const totalConvertedAmount = filteredExpenses.reduce((total, expense) => {
        return total + convertCurrency(expense.amount, expense.currency, displayCurrency);
    }, 0);

    return (
        <main className="flex-1 p-4 sm:p-8 overflow-y-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold">{project.name} Report</h1>
                    <p className="text-gray-400">All amounts shown in {displayCurrency}</p>
                </div>
                 <div className="flex items-center space-x-4 mt-2 sm:mt-0">
                    <button onClick={() => setShowFilters(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-md">Filters</button>
                    <select value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value)} className="bg-gray-700 p-2 rounded-md">
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => onSwitchView('dashboard')} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md">
                        Back to Dashboard
                    </button>
                 </div>
            </div>
            
            {showFilters && (
                 <ModalWrapper title="Filter Report" onClose={() => setShowFilters(false)}>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm">Start Date</label>
                                <input type="date" name="startDate" value={filters.startDate} onChange={handleFilterChange} className="bg-gray-700 p-2 rounded-md w-full"/>
                            </div>
                            <div>
                                <label className="block text-sm">End Date</label>
                                <input type="date" name="endDate" value={filters.endDate} onChange={handleFilterChange} className="bg-gray-700 p-2 rounded-md w-full"/>
                            </div>
                        </div>
                        <select name="payeeId" value={filters.payeeId} onChange={handleFilterChange} className="bg-gray-700 p-2 rounded-md w-full">
                            <option value="all">All Payees</option>
                            {membersData.map(m => <option key={m.id} value={m.id}>{m.username}</option>)}
                        </select>
                         <select name="category" value={filters.category} onChange={handleFilterChange} className="bg-gray-700 p-2 rounded-md w-full">
                            <option value="all">All Categories</option>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select name="payerId" value={filters.payerId} onChange={handleFilterChange} className="bg-gray-700 p-2 rounded-md w-full">
                            <option value="all">All Payers</option>
                            {membersData.map(m => <option key={m.id} value={m.id}>{m.username}</option>)}
                        </select>
                        <div className="flex justify-end gap-4">
                           <button onClick={resetFilters} className="bg-gray-600 p-2 px-4 rounded-md">Reset</button>
                           <button onClick={() => setShowFilters(false)} className="bg-blue-600 p-2 px-4 rounded-md">Apply</button>
                        </div>
                    </div>
                </ModalWrapper>
            )}

            <div className="bg-gray-800 rounded-lg overflow-hidden mb-8">
                <h2 className="text-xl font-semibold mb-4 p-4">Trip Summary</h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-700">
                            <tr>
                                <th className="p-3">Date</th><th className="p-3">Description</th><th className="p-3">Payee</th><th className="p-3">Category</th>
                                <th className="p-3">Payers</th><th className="p-3 text-right">Original Amt.</th>
                                <th className="p-3 text-right">Amount ({displayCurrency})</th>
                            </tr>
                        </thead>
                        <tbody>
                             {[...filteredExpenses].sort((a,b) => (b.expenseDate?.seconds || 0) - (a.expenseDate?.seconds || 0)).map(expense => {
                                const convertedAmount = convertCurrency(expense.amount, expense.currency, displayCurrency);
                                return (
                                    <tr key={expense.id} className="border-b border-gray-700 last:border-b-0">
                                        <td className="p-3 whitespace-nowrap">{expense.expenseDate ? new Date(expense.expenseDate.seconds * 1000).toLocaleDateString() : ''}</td>
                                        <td className="p-3">{expense.description}</td><td className="p-3">{expense.payeeUsername}</td><td className="p-3">{expense.category}</td>
                                        <td className="p-3 text-sm text-gray-400">{(expense.payerUsernames || []).join(', ')}</td>
                                        <td className="p-3 text-right whitespace-nowrap">{expense.amount.toFixed(2)} {expense.currency}</td>
                                        <td className="p-3 text-right font-bold">{convertedAmount.toFixed(2)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-gray-700"><tr className="font-bold text-lg"><td colSpan="6" className="p-3 text-right">Grand Total</td><td className="p-3 text-right">{totalConvertedAmount.toFixed(2)}</td></tr></tfoot>
                    </table>
                </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-6">
                <h2 className="text-xl font-semibold mb-4">Final Settlement</h2>
                <table className="w-full text-left">
                    <thead className="border-b-2 border-gray-700"><tr className="text-gray-400">
                        <th className="p-2">Member</th><th className="p-2 text-right">Total Paid</th><th className="p-2 text-right">Total Share</th><th className="p-2 text-right">Net Balance</th>
                    </tr></thead>
                    <tbody>
                        {summary.map(({ username, totalPaid, totalOwed, netBalance }) => (
                            <tr key={username} className="border-b border-gray-700 last:border-b-0">
                                <td className="p-2 font-semibold">{username}</td>
                                <td className="p-2 text-right">{totalPaid.toFixed(2)}</td>
                                <td className="p-2 text-right text-orange-400">{totalOwed.toFixed(2)}</td>
                                <td className={`p-2 text-right font-bold ${netBalance >= 0 ? 'text-green-400' : 'text-red-500'}`}>
                                    {netBalance >= 0 ? `Owed ${netBalance.toFixed(2)}` : `Owes ${Math.abs(netBalance).toFixed(2)}`}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </main>
    );
};


const ModalWrapper = ({ children, title, onClose }) => (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-lg relative">
            <h2 className="text-2xl font-bold mb-4">{title}</h2>
            <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">&times;</button>
            {children}
        </div>
    </div>
);

const AddProjectModal = ({ userId, db, onClose }) => {
    const [projectName, setProjectName] = useState('');
    const [defaultCurrency, setDefaultCurrency] = useState(CURRENCIES[0]);
    const [memberUsername, setMemberUsername] = useState('');
    const [members, setMembers] = useState([]);
    const [error, setError] = useState('');
    
    const handleAddMember = async () => {
        if (!memberUsername.trim()) return;
        setError('');
        try {
            const userQuery = query(collection(db, "users"), where("username", "==", memberUsername.trim()));
            const querySnapshot = await getDocs(userQuery);
            if (querySnapshot.empty) { setError(`User "${memberUsername}" not found.`); return; }
            const userToAdd = querySnapshot.docs[0];
            if (members.find(m => m.uid === userToAdd.id) || userId === userToAdd.id) { setError(`User "${memberUsername}" is already in the project.`); return; }
            setMembers([...members, { uid: userToAdd.id, username: userToAdd.data().username }]);
            setMemberUsername('');
        } catch (err) {
            setError(`Failed to add member: ${err.message}`);
        }
    };

    const handleCreateProject = async (e) => {
        e.preventDefault();
        if (!projectName.trim()) { setError('Trip name is required.'); return; }
        const memberIds = [userId, ...members.map(m => m.uid)];
        try {
             await addDoc(collection(db, "projects"), { name: projectName.trim(), owner: userId, members: memberIds, defaultCurrency: defaultCurrency, createdAt: serverTimestamp() });
            onClose();
        } catch (err) {
            setError(`Failed to create trip: ${err.message}`);
        }
    };
    
    return (
        <ModalWrapper title="Create New Trip" onClose={onClose}>
            <form onSubmit={handleCreateProject}>
                <div className="flex gap-4 mb-4">
                    <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Trip Name (e.g., Japan 2025)" className="w-2/3 p-3 bg-gray-700 rounded-md border border-gray-600"/>
                    <select value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)} className="w-1/3 p-3 bg-gray-700 rounded-md border border-gray-600">
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-400 mb-2">Add Members by Username</label>
                    <div className="flex">
                        <input type="text" value={memberUsername} onChange={(e) => setMemberUsername(e.target.value)} placeholder="Enter username" className="flex-grow p-3 bg-gray-700 rounded-l-md border border-gray-600"/>
                        <button type="button" onClick={handleAddMember} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-r-md">Add</button>
                    </div>
                </div>
                <div className="mb-4 h-24 overflow-y-auto">
                    <p className="text-gray-400">Members:</p>
                    <ul className="list-disc list-inside text-gray-300">
                       {members.map(m => <li key={m.uid}>{m.username}</li>)}
                       <li>You (Owner)</li>
                    </ul>
                </div>
                {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                <div className="flex justify-end gap-4">
                    <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded">Cancel</button>
                    <button type="submit" className="bg-green-600 hover:bg-green-700 font-bold py-2 px-4 rounded">Create</button>
                </div>
            </form>
        </ModalWrapper>
    );
};

const EditProjectModal = ({ project, userId, db, onClose, onDeleteProject }) => {
    const [projectName, setProjectName] = useState(project.name);
    const [defaultCurrency, setDefaultCurrency] = useState(project.defaultCurrency);
    const [memberUsername, setMemberUsername] = useState('');
    const [members, setMembers] = useState([]);
    const [error, setError] = useState('');
    const [shareLink, setShareLink] = useState('');

    useEffect(() => {
        getUsernames(db, project.members).then(setMembers)
    },[db, project.members])

    const handleAddMember = async () => {
        if (!memberUsername.trim()) return;
        setError('');
        try {
            const userQuery = query(collection(db, "users"), where("username", "==", memberUsername.trim()));
            const querySnapshot = await getDocs(userQuery);
            if (querySnapshot.empty) { setError(`User "${memberUsername}" not found.`); return; }
            const userToAdd = querySnapshot.docs[0];
            if (members.find(m => m.id === userToAdd.id) || userId === userToAdd.id) { setError(`User "${memberUsername}" is already in the project.`); return; }
            setMembers([...members, { id: userToAdd.id, username: userToAdd.data().username }]);
            setMemberUsername('');
        } catch (err) {
            setError(`Failed to add member: ${err.message}`);
        }
    };

     const removeMember = (memberId) => {
        setMembers(members.filter(m => m.id !== memberId));
    };

    const handleUpdateProject = async (e) => {
        e.preventDefault();
        if (!projectName.trim()) { setError('Trip name is required.'); return; }
        const memberIds = members.map(m => m.id);
        if(!memberIds.includes(userId)) {
             memberIds.push(userId); // Ensure owner is always a member
        }
        
        const projectRef = doc(db, 'projects', project.id);
        try {
             await updateDoc(projectRef, { name: projectName.trim(), members: memberIds, defaultCurrency: defaultCurrency });
            onClose();
        } catch (err) {
            setError(`Failed to update trip: ${err.message}`);
        }
    };
    
    return (
        <ModalWrapper title="Edit Trip" onClose={onClose}>
            <form onSubmit={handleUpdateProject}>
                <div className="flex gap-4 mb-4">
                    <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Trip Name (e.g., Japan 2025)" className="w-2/3 p-3 bg-gray-700 rounded-md border border-gray-600"/>
                    <select value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)} className="w-1/3 p-3 bg-gray-700 rounded-md border border-gray-600">
                        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-400 mb-2">Add Members by Username</label>
                    <div className="flex">
                        <input type="text" value={memberUsername} onChange={(e) => setMemberUsername(e.target.value)} placeholder="Enter username" className="flex-grow p-3 bg-gray-700 rounded-l-md border border-gray-600"/>
                        <button type="button" onClick={handleAddMember} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-r-md">Add</button>
                    </div>
                </div>
                <div className="mb-4 h-24 overflow-y-auto">
                    <p className="text-gray-400">Members:</p>
                    <ul className="list-disc list-inside text-gray-300">
                       {members.map(m => (
                           <li key={m.id} className="flex justify-between items-center">
                               {m.username}
                               {m.id !== project.owner && <button type="button" onClick={() => removeMember(m.id)} className="text-red-500 text-xs ml-2">Remove</button>}
                           </li>
                        ))}
                    </ul>
                </div>
                {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                <div className="flex justify-between items-center gap-4">
                     <button type="button" onClick={() => {onDeleteProject(project); onClose();}} className="bg-red-800 hover:bg-red-700 font-bold py-2 px-4 rounded">Delete Trip</button>
                    <div className="flex gap-4">
                        <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded">Cancel</button>
                        <button type="submit" className="bg-green-600 hover:bg-green-700 font-bold py-2 px-4 rounded">Save Changes</button>
                    </div>
                </div>
            </form>
        </ModalWrapper>
    );
};

const PayerSelection = ({ members, selected, onSelectionChange }) => {
    const toggleMember = (memberId) => {
        const safeSelected = Array.isArray(selected) ? selected : [];
        const isSelected = safeSelected.includes(memberId);
        const newSelection = isSelected 
            ? safeSelected.filter(id => id !== memberId)
            : [...safeSelected, memberId];
        onSelectionChange(newSelection);
    };
    
    const handleSelectAll = () => {
        const safeSelected = Array.isArray(selected) ? selected : [];
        if (safeSelected.length === members.length) {
            onSelectionChange([]); // Deselect all
        } else {
            onSelectionChange(members.map(m => m.id)); // Select all
        }
    };
    
    const safeSelected = Array.isArray(selected) ? selected : [];

    return (
        <div className="mb-4">
            <label className="block text-sm font-medium text-gray-400 mb-2">Payers</label>
            <div className="bg-gray-700 p-3 rounded-md">
                <button type="button" onClick={handleSelectAll} className="text-blue-400 hover:text-blue-300 mb-2 text-sm">
                    {safeSelected.length === members.length && members.length > 0 ? 'Deselect All' : 'Select All'}
                </button>
                <div className="flex flex-wrap gap-2">
                    {members.map(member => {
                        const isSelected = safeSelected.includes(member.id);
                        return (
                             <button
                                type="button"
                                key={member.id}
                                onClick={() => toggleMember(member.id)}
                                className={`px-3 py-1 text-sm rounded-full transition-colors ${isSelected ? 'bg-blue-600 text-white' : 'bg-gray-600 hover:bg-gray-500'}`}
                            >
                                {member.username}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const AddExpenseModal = ({ project, userId, db, onClose }) => {
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [payers, setPayers] = useState([]);
    const [payments, setPayments] = useState([{ payeeId: userId, amount: '', currency: project.defaultCurrency || CURRENCIES[0] }]);
    const [projectMembers, setProjectMembers] = useState([]);
    const [error, setError] = useState('');

    useEffect(() => {
        if (db && project.members) {
            getUsernames(db, project.members).then(members => {
                setProjectMembers(members);
                setPayers(members.map(m => m.id)); // Default to all selected
            });
        }
    }, [db, project.members]);

    const handlePaymentChange = (index, field, value) => {
        const newPayments = [...payments];
        newPayments[index][field] = value;
        setPayments(newPayments);
    };

    const addPayment = () => {
        setPayments([...payments, { payeeId: projectMembers[0]?.id || '', amount: '', currency: project.defaultCurrency || CURRENCIES[0] }]);
    };

    const removePayment = (index) => {
        const newPayments = payments.filter((_, i) => i !== index);
        setPayments(newPayments);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!description.trim() || payers.length === 0 || !category) {
            setError('Description, Category, and at least one Payer are required.');
            return;
        }

        const validPayments = payments.filter(p => p.amount && p.payeeId);
        if (validPayments.length === 0) {
            setError('At least one valid payment (Payee and Amount) is required.');
            return;
        }

        const transactionGroupId = doc(collection(db, "groups")).id; // Generate a unique ID for this transaction batch

        try {
            const promises = validPayments.map(payment => {
                return addDoc(collection(db, "projects", project.id, "expenses"), {
                    transactionGroupId,
                    description: description.trim(),
                    category,
                    expenseDate: Timestamp.fromDate(new Date(date)),
                    payers,
                    payeeId: payment.payeeId,
                    amount: parseFloat(payment.amount),
                    currency: payment.currency,
                    createdAt: serverTimestamp(),
                });
            });

            await Promise.all(promises);
            onClose();

        } catch(err)  {
            setError(`Failed to add expense: ${err.message}`);
        }
    };

    return (
        <ModalWrapper title="Add an Expense" onClose={onClose}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Expense Description" className="w-full p-3 bg-gray-700 rounded-md border border-gray-600"/>
                 <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600">
                    <option value="" disabled>Select a Category</option>
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600"/>

                <hr className="border-gray-600"/>
                
                {payments.map((payment, index) => (
                    <div key={index} className="flex items-center gap-2">
                         <select value={payment.payeeId} onChange={(e) => handlePaymentChange(index, 'payeeId', e.target.value)} className="w-1/3 p-2 bg-gray-600 rounded-md border border-gray-500">
                             <option value="" disabled>Select Payee</option>
                             {projectMembers.map(member => <option key={member.id} value={member.id}>{member.username}</option>)}
                        </select>
                         <input type="number" value={payment.amount} onChange={(e) => handlePaymentChange(index, 'amount', e.target.value)} placeholder="Amount" className="w-1/3 p-2 bg-gray-600 rounded-md border border-gray-500" />
                         <select value={payment.currency} onChange={(e) => handlePaymentChange(index, 'currency', e.target.value)} className="w-1/4 p-2 bg-gray-600 rounded-md border border-gray-500">
                            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {payments.length > 1 && (
                            <button type="button" onClick={() => removePayment(index)} className="text-red-500 hover:text-red-400 p-1">&times;</button>
                        )}
                    </div>
                ))}
                
                <button type="button" onClick={addPayment} className="text-blue-400 hover:text-blue-300 text-sm">+ Add another Payee</button>

                <hr className="border-gray-600"/>

                <PayerSelection members={projectMembers} selected={payers} onSelectionChange={setPayers} />
                
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <div className="flex justify-end gap-4"><button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded">Cancel</button><button type="submit" className="bg-blue-600 hover:bg-blue-700 font-bold py-2 px-4 rounded">Add</button></div>
            </form>
        </ModalWrapper>
    );
};

const EditExpenseModal = ({ expenseGroup, project, userId, db, onClose }) => {
    const firstExpense = expenseGroup[0];
    const [description, setDescription] = useState(firstExpense.description);
    const [category, setCategory] = useState(firstExpense.category);
    const [date, setDate] = useState(firstExpense.expenseDate ? firstExpense.expenseDate.toDate().toISOString().split('T')[0] : '');
    const [payers, setPayers] = useState(firstExpense.payers);
    const [payments, setPayments] = useState(expenseGroup.map(exp => ({ payeeId: exp.payeeId, amount: exp.amount, currency: exp.currency, id: exp.id })));
    const [projectMembers, setProjectMembers] = useState([]);
    const [error, setError] = useState('');

    useEffect(() => {
        if (db && project.members) {
            getUsernames(db, project.members).then(setProjectMembers);
        }
    }, [db, project.members]);

    const handlePaymentChange = (index, field, value) => {
        const newPayments = [...payments];
        newPayments[index][field] = value;
        setPayments(newPayments);
    };

    const addPayment = () => {
        setPayments([...payments, { payeeId: projectMembers[0]?.id || '', amount: '', currency: project.defaultCurrency || CURRENCIES[0], id: null }]); // New payments don't have an ID yet
    };

    const removePayment = (index) => {
        const newPayments = payments.filter((_, i) => i !== index);
        setPayments(newPayments);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!description.trim() || payers.length === 0) {
            setError('Description and at least one Payer are required.');
            return;
        }

        const validPayments = payments.filter(p => p.amount && p.payeeId);
        if (validPayments.length === 0) {
            setError('At least one valid payment (Payee and Amount) is required.');
            return;
        }

        try {
            const batch = writeBatch(db);
            const existingIds = validPayments.map(p => p.id).filter(Boolean);
            
            // Delete expenses that are no longer in the payments list
            expenseGroup.forEach(originalExpense => {
                if (!existingIds.includes(originalExpense.id)) {
                    const expenseRef = doc(db, "projects", project.id, "expenses", originalExpense.id);
                    batch.delete(expenseRef);
                }
            });

            // Update existing or add new payments
            validPayments.forEach(payment => {
                const expenseRef = payment.id ? doc(db, "projects", project.id, "expenses", payment.id) : doc(collection(db, "projects", project.id, "expenses"));
                const data = {
                    transactionGroupId: firstExpense.transactionGroupId,
                    description: description.trim(),
                    category,
                    expenseDate: Timestamp.fromDate(new Date(date)),
                    payers,
                    payeeId: payment.payeeId,
                    amount: parseFloat(payment.amount),
                    currency: payment.currency,
                };
                if(payment.id) {
                    batch.update(expenseRef, data);
                } else {
                    batch.set(expenseRef, {...data, createdAt: serverTimestamp()});
                }
            });

            await batch.commit();
            onClose();

        } catch (err) {
            setError(`Failed to update expense: ${err.message}`);
        }
    };

    return (
        <ModalWrapper title="Edit Expense" onClose={onClose}>
            <form onSubmit={handleSubmit} className="space-y-4">
                 <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Expense Description" className="w-full p-3 bg-gray-700 rounded-md border border-gray-600"/>
                 <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600">
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full p-3 bg-gray-700 rounded-md border border-gray-600"/>

                <hr className="border-gray-600"/>
                
                {payments.map((payment, index) => (
                    <div key={index} className="flex items-center gap-2">
                         <select value={payment.payeeId} onChange={(e) => handlePaymentChange(index, 'payeeId', e.target.value)} className="w-1/3 p-2 bg-gray-600 rounded-md border border-gray-500">
                             <option value="" disabled>Select Payee</option>
                             {projectMembers.map(member => <option key={member.id} value={member.id}>{member.username}</option>)}
                        </select>
                         <input type="number" value={payment.amount} onChange={(e) => handlePaymentChange(index, 'amount', e.target.value)} placeholder="Amount" className="w-1/3 p-2 bg-gray-600 rounded-md border border-gray-500" />
                         <select value={payment.currency} onChange={(e) => handlePaymentChange(index, 'currency', e.target.value)} className="w-1/4 p-2 bg-gray-600 rounded-md border border-gray-500">
                            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {payments.length > 1 && (
                            <button type="button" onClick={() => removePayment(index)} className="text-red-500 hover:text-red-400 p-1">&times;</button>
                        )}
                    </div>
                ))}
                
                <button type="button" onClick={addPayment} className="text-blue-400 hover:text-blue-300 text-sm">+ Add another Payee</button>

                <hr className="border-gray-600"/>

                <PayerSelection members={projectMembers} selected={payers} onSelectionChange={setPayers} />
                
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <div className="flex justify-end gap-4"><button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded">Cancel</button><button type="submit" className="bg-green-600 hover:bg-green-700 font-bold py-2 px-4 rounded">Save Changes</button></div>
            </form>
        </ModalWrapper>
    );
};

const ConfirmModal = ({ title, message, onConfirm, onCancel }) => (
    <ModalWrapper title={title} onClose={onCancel}>
        <p className="text-gray-300 mb-6">{message}</p>
        <div className="flex justify-end gap-4">
            <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-700 font-bold py-2 px-4 rounded">Cancel</button>
            <button onClick={onConfirm} className="bg-red-600 hover:bg-red-700 font-bold py-2 px-4 rounded">Confirm</button>
        </div>
    </ModalWrapper>
);

const AccountModal = ({ user, username, onLogout, onClose }) => (
    <ModalWrapper title="My Account" onClose={onClose}>
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-400">Username</label>
                <p className="text-lg">{username}</p>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-400">Email</label>
                <p className="text-lg">{user.email}</p>
            </div>
            <button
                onClick={onLogout}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md"
            >
                Logout
            </button>
        </div>
    </ModalWrapper>
);

const BottomNavBar = ({ onAddExpense, onShowAccount, onShowTrips, onShowReport, onShowNotifications, hasUnreadNotifications }) => (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-gray-800 border-t-2 border-gray-700 flex justify-around items-center p-2 z-30">
        <div className="flex justify-around w-2/5">
            <button onClick={onShowTrips} className="flex flex-col items-center text-gray-400 hover:text-white p-2">
                 <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                 <span className="text-sm font-semibold">Trips</span>
            </button>
            <button onClick={onShowNotifications} className="flex flex-col items-center text-gray-400 hover:text-white p-2 relative">
                 {hasUnreadNotifications && <span className="absolute top-1 right-1 block h-3 w-3 rounded-full bg-red-500"></span>}
                 <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                 <span className="text-sm font-semibold">Notifications</span>
            </button>
        </div>
        <div className="w-1/5 flex justify-center">
            <button onClick={onAddExpense} className="bg-blue-600 p-4 rounded-full text-white shadow-lg -mt-8">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
            </button>
        </div>
        <div className="flex justify-around w-2/5">
            <button onClick={onShowReport} className="flex flex-col items-center text-gray-400 hover:text-white p-2">
                <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                 <span className="text-sm font-semibold">Report</span>
            </button>
             <button onClick={onShowAccount} className="flex flex-col items-center text-gray-400 hover:text-white p-2">
                <svg className="w-8 h-8 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                 <span className="text-sm font-semibold">Account</span>
            </button>
        </div>
    </nav>
);

const ChartCarousel = ({ charts }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);

    const handleTouchStart = (e) => {
        touchStartX.current = e.targetTouches[0].clientX;
    };

    const handleTouchMove = (e) => {
        touchEndX.current = e.targetTouches[0].clientX;
    };

    const handleTouchEnd = () => {
        if (touchStartX.current - touchEndX.current > 50) {
            // Swiped left
            setCurrentIndex(prev => (prev === charts.length - 1 ? 0 : prev + 1));
        }

        if (touchStartX.current - touchEndX.current < -50) {
            // Swiped right
            setCurrentIndex(prev => (prev === 0 ? charts.length - 1 : prev - 1));
        }
    };
    
    return (
        <div className="relative">
            <div className="overflow-hidden" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
                <div className="flex transition-transform ease-out duration-300" style={{ transform: `translateX(-${currentIndex * 100}%)` }}>
                    {charts.map((chart, index) => (
                        <div key={index} className="w-full flex-shrink-0 bg-gray-800 p-4 sm:p-6 rounded-lg">
                            <h2 className="text-xl font-semibold mb-4 text-center">{chart.title}</h2>
                            {chart.component}
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex justify-center mt-4">
                {charts.map((_, index) => (
                    <button key={index} onClick={() => setCurrentIndex(index)} className={`h-2 w-2 rounded-full mx-1 ${currentIndex === index ? 'bg-blue-500' : 'bg-gray-500'}`}></button>
                ))}
            </div>
        </div>
    );
};

const NotificationsModal = ({ notifications, db, onClose, setCurrentProject, projects }) => {
    useEffect(() => {
        const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
        if (unreadIds.length > 0) {
            const batch = writeBatch(db);
            unreadIds.forEach(id => {
                const notifRef = doc(db, 'notifications', id);
                batch.update(notifRef, { read: true });
            });
            batch.commit();
        }
    }, [notifications, db]);

    const handleNotificationClick = (notification) => {
        const project = projects.find(p => p.id === notification.tripId);
        if (project) {
            setCurrentProject(project);
        }
        onClose();
    };

    return (
        <ModalWrapper title="Notifications" onClose={onClose}>
            <ul className="divide-y divide-gray-700 -mx-6">
                {notifications.length > 0 ? (
                    notifications.map(n => (
                        <li key={n.id} onClick={() => handleNotificationClick(n)} className="p-4 hover:bg-gray-700 cursor-pointer">
                            <p className="text-sm">{n.message}</p>
                            <p className="text-xs text-gray-400 mt-1">{n.createdAt?.toDate().toLocaleString()}</p>
                        </li>
                    ))
                ) : (
                    <p className="p-4 text-center text-gray-400">No notifications yet.</p>
                )}
            </ul>
        </ModalWrapper>
    );
};


// --- Final App Component Wrapper ---
const App = () => (
    <FirebaseProvider>
        <AppLogic />
    </FirebaseProvider>
);

export default App;
