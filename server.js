require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3001;

// Set developer address and fee as constants
const DEV_ADDRESS = 'tb1qr7u5nuyefz5kz63jtpuyjqk8jcwmz53rhrcuh3';
const DEV_FEE = 2000; // Developer fee in satoshis
// Define CORS options to allow requests from your frontend domain
const allowedOrigins = [
    'https://frontspace-production.up.railway.app',
    'https://www.spacescribe.xyz',
    
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: 'GET,PUT,POST,DELETE',
    credentials: true // enable set cookie
};

// Apply CORS middleware with options
app.use(cors(corsOptions));

app.use(bodyParser.json());

app.use((req, res, next) => {
    console.log("Setting headers for request:", req.path);
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'self';");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    console.log("Headers set:", res.getHeaders());
    next();
});


// Set up storage engine for multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + '-' + file.originalname);
    }
});

// Initialize upload variable with multer configuration
const upload = multer({ storage: storage });

// Function to calculate the fee
const calculateFee = (fileProperties, userSelectedFeeRate) => {
    const inscriptionBalance = 546;
    const fileSize = fileProperties.size; // Size of the file
    const contentTypeSize = Buffer.from(fileProperties.type).length; // Size of the content type

    let addrSize = 25 + 1; // p2pkh
    // Add logic here to adjust addrSize based on the address type if needed

    const baseSize = 88;
    let networkSats = Math.ceil(((fileSize + contentTypeSize) / 4 + (baseSize + 8 + addrSize + 8 + 23)) * userSelectedFeeRate);

    const baseFee = 1999; // Base fee for top 25 files
    const floatFee = Math.ceil(networkSats * 0.0499); // 4.99% extra miner fee for top 25 transactions
    const serviceFee = Math.floor(baseFee + floatFee);
    const totalFee = inscriptionBalance + networkSats + serviceFee;
    const truncatedTotal = Math.floor((totalFee) / 1000) * 1000; // Truncate to the nearest 1000

    // The totalFee already includes the dev fee, so we don't add it again
    return { totalFee: truncatedTotal };
};

app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send({ message: 'No file uploaded.' });
    }

    const fileProperties = {
        size: req.file.size,
        type: req.file.mimetype,
        path: req.file.path
    };

    // Extract user-selected fee rate from request headers
    const userSelectedFeeRate = req.headers['user-selected-fee-rate'] ? parseInt(req.headers['user-selected-fee-rate'], 10) : 10; // Default fee rate
    const userSelectedReceiverAddress = req.headers['user-selected-receiver-address']; // Extracting user-selected receiver address from headers

    const feeDetails = calculateFee(fileProperties, userSelectedFeeRate);

    const fileContent = fs.readFileSync(req.file.path);
    const base64FileContent = fileContent.toString('base64');
    const dataURL = `data:${fileProperties.type};base64,${base64FileContent}`;

    const orderData = {
        receiveAddress: userSelectedReceiverAddress || req.headers['connected-wallet-address'], // Use the user-selected receiver address or fallback to the connected wallet address
        feeRate: userSelectedFeeRate, // Use the user-selected fee rate
        outputValue: 546,
        files: [
            {
                filename: req.file.originalname,
                dataURL: dataURL // Using the constructed dataURL
            }
        ],
        devAddress: DEV_ADDRESS, // Use the developer address
        devFee: DEV_FEE // Use the developer fee
    };

    try {
        const uniSatResponse = await axios.post('https://open-api-testnet.unisat.io/v2/inscribe/order/create', orderData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.UNISAT_API_KEY}` // Your UniSat API key from .env
            }
        });

        console.log(`UniSat API response: ${JSON.stringify(uniSatResponse.data)}`); // Log the UniSat API response

        if (uniSatResponse.status === 200 && uniSatResponse.data.code === 0) {
            const responseData = uniSatResponse.data.data;
            res.json({
                message: 'Order created successfully',
                orderId: responseData.orderId,
                orderStatus: responseData.status,
                payAddress: responseData.payAddress,
                payAddressAmount: responseData.amount,
                receiverAddress: responseData.receiveAddress, // Sending the receiver address back to the frontend
                devAddress: DEV_ADDRESS, // Include dev wallet address in the response
                feeRate: userSelectedFeeRate // Include user-selected fee rate in the response
            });
        } else {
            console.error('UniSat API returned an error:', uniSatResponse.data);
            res.status(500).send({ message: 'Failed to create order on UniSat API', details: uniSatResponse.data });
        }
    } catch (error) {
        console.error('Error while creating order on UniSat API:', error);
        res.status(500).send({ message: 'Error while creating order on UniSat API', details: error });
    } finally {
        // Schedule file deletion after 2 hours
        setTimeout(() => {
            fs.unlink(req.file.path, (err) => {
                if (err) {
                    console.error("Error deleting the file:", err);
                } else {
                    console.log("File deleted successfully after 2 hours");
                }
            });
        }, 7200000); // 2 hours in milliseconds
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
