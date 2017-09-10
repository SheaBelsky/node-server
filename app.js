require("dotenv").load();
const async      = require("async");
const base64     = require('node-base64-image');
const bodyParser = require("body-parser");
const diff       = require("lodash.differenceby");
const express    = require("express");
const mysql      = require("mysql");
const morgan     = require("morgan");
const port       = process.env.PORT || 3000;

// MySQL
const config = require("./config");
const options = {
    user: config.get('MYSQL_USER'),
    password: config.get('MYSQL_PASSWORD'),
    database: 'food'
};
if (config.get('INSTANCE_CONNECTION_NAME') && config.get('NODE_ENV') === 'production') {
    options.socketPath = `/cloudsql/${config.get('INSTANCE_CONNECTION_NAME')}`;
}
const connection = mysql.createConnection(options);

// Visual Recognition
let vision;
if (process.env.NODE_ENV !== "production") {
    vision    = require("@google-cloud/vision")({
        projectId: "smartfridgelibrary",
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });
}
else {
    vision = require("@google-cloud/vision")();
}

// Express
const app                 = express();
app.use(bodyParser.text());
app.use(morgan(":method :url :status :res[content-length] - :response-time ms"));
app.use(bodyParser.json({limit: "10mb"}));
app.use(bodyParser.urlencoded({extended: true, limit: "10mb"}));
app.use(express.static(__dirname + '/public'));

// Routes
app.get("/analyze", (req, res) => {
    return res.sendFile("public/analyze.html", {root: __dirname });
});

app.post("/analyze", (req, res) => {
    async.waterfall([
        (cb) => {
            // Send base64 image to Google Vision
            vision.annotateImage({
                image: { content: new Buffer(req.body.base64, 'base64') },
                features: [
                    {
                        type: "LABEL_DETECTION",
                        maxResults: 10
                    }
                ]
            })
            .then(result => cb(null, result))
            .catch(err   => cb(err));
        },
        // If we got an actual result, pass it along
        (result, cb) => {
            if (result[0].labelAnnotations && result[0].labelAnnotations.length > 0) {
                return cb(null, result[0].labelAnnotations);
            }
            else {
                return cb(result[0].error);
            }
        },
        (annotations, cb) => {
            // Filter for just the top annotations
            annotations = annotations.filter(curAnnotation => curAnnotation.score > 0.75);
            // Iterate over each annotation and see if we currently have it in the fridge
            // If we do, do nothing
            // If we don't, insert it
            async.each(annotations, (curAnnotation, cb) => {
                async.waterfall([
                    (cb) => {
                        connection.query(`SELECT * FROM uniqueFood WHERE name = '${curAnnotation.description}'`, cb);
                    },
                    (food, something, cb) => {
                        if (!food || !(food.length > 0)) {
                            // Food does not exist
                            connection.query(`INSERT INTO uniqueFood (name) VALUES ('${curAnnotation.description}')`, cb);
                        }
                        else {
                            // Food already exists
                            return cb(null);
                        }
                    }
                ], cb)
            }, (err) => {
                return cb(err, annotations);
            });
        },
        (annotations, cb) => {
            // Map an annotation's description to its name (for later comparison)
            annotations.forEach((curAnnotation) => {
                curAnnotation.name = curAnnotation.description;
            });
            // Get all of our food after previous insertions
            connection.query("SELECT * FROM uniqueFood", (err, allFood) => {
                if (!err) {
                    // Determine food objects that no longer exist, delete them
                    const deleteObj = diff(allFood, annotations, "name");
                    if (deleteObj.length > 0) {
                        async.each(deleteObj, (curFood, cb) => {
                            connection.query(`DELETE FROM uniqueFood WHERE name='${curFood.name}'`, cb)
                        }, cb);
                    }
                    else {
                        return cb(null);
                    }
                }
                else {
                    return cb(err);
                }
            });
        },
    ], (err) => {
        // Get all of our food after previous deletions
        if (!err) {
            connection.query("SELECT * FROM uniqueFood", (err, allFood) => {
                if (!err) {
                    return res.status(200).json(allFood);
                }
                else {
                    console.error(err);
                    return res.status(500).send(err);
                }
            });
        }
        else {
            console.error(err);
            return res.status(500).send(err);
        }
    })
});

// Launch
app.listen(port, () => {
    console.log(`App listening on port ${port}.`);
});
