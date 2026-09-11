
const mongoose = require('mongoose');
const SerialTracker = require('./SerialTracker');

const STATUS_VALUES = [
   'Open',
  'In Progress',
  'Rejected',
  'Resolved',
  'Cancelled'
];

const REQUEST_TYPES = [
  'grievance',
  'appeal',
  'complaint'
];

const AppGrievCompSchema = new mongoose.Schema(
  {
    leader_regd_mobile_no: {
      type: String,
      required: true
    },

    user_email_id: {
      type: String,
      required: true
    },

    // Auto-generated:
    // griev10000
    // appe10000
    // compl10000
    regn_no: {
      type: String,
      unique: true,
      index: true
    },

    request_type: {
      type: String,
      required: true,
      lowercase: true,
      enum: REQUEST_TYPES
    },

    applicant_mobile: {
      type: String
    },

    applicant_name: {
      type: String
    },

    fh_name: {
      type: String
    },

    address: {
      type: String
    },

    pincode: {
      type: String
    },

    post_office: {
      type: String
    },

    district: {
      type: String
    },

    state: {
      type: String
    },

    description: {
      type: String
    },

    // Current request status
    status: {
      type: String,
      enum: STATUS_VALUES,
      default: 'Open'
    },

    // Latest comment/action taken by admin
    action_taken_comments: {
      type: String,
      default: ''
    },

    // Name of admin who last updated the request
    updated_by: {
      type: String,
      default: ''
    },

    device_ip_number: {
      type: String
    }
  },
  {
    timestamps: true
  }
);


/*
|--------------------------------------------------------------------------
| Auto-generate Registration Number
|--------------------------------------------------------------------------
|
| grievance -> griev10000
| appeal    -> appe10000
| complaint -> compl10000
|
*/

AppGrievCompSchema.pre('save', async function (next) {
  if (this.regn_no) {
    return next();
  }

  try {
    let key = '';
    let prefix = '';

    switch ((this.request_type || '').toLowerCase()) {
      case 'grievance':
        key = 'griev';
        prefix = 'griev';
        break;

      case 'appeal':
        key = 'appe';
        prefix = 'appe';
        break;

      case 'complaint':
        key = 'compl';
        prefix = 'compl';
        break;

      default:
        return next(new Error('Invalid request_type'));
    }

    let tracker = await SerialTracker.findOne({ key });

    if (!tracker) {
      tracker = await SerialTracker.create({
        key,
        last_serial: 9999
      });
    }

    tracker.last_serial += 1;

    await tracker.save();

    this.regn_no = `${prefix}${tracker.last_serial}`;

    next();

  } catch (err) {
    next(err);
  }
});


module.exports = mongoose.model(
  'AppGrievComp',
  AppGrievCompSchema
);












//21-08-2026 commented

// const mongoose = require('mongoose');
// const SerialTracker = require('./SerialTracker');

// const AppGrievCompSchema = new mongoose.Schema({
//   leader_regd_mobile_no: { type: String, required: true },
//   user_email_id: { type: String, required: true },
//   regn_no: { type: String, unique: true }, // auto-generated
//   request_type: String,
//   applicant_mobile: String,
//   applicant_name: String,
//   fh_name: String,
//   address: String,
//   pincode: String,
//   post_office: String,
//   district: String,
//   state: String,
//   description: String,
//   status: { type: String, default: 'Open' },
//   action_taken_comments: { type: String, default: '' },
//   updated_by: { type: String, default: '' },
//   device_ip_number: String
// }, { timestamps: true });

// AppGrievCompSchema.pre("save", async function (next) {
//   if (this.regn_no) return next();

//   try {

//     let key = "";
//     let prefix = "";

//     switch ((this.request_type || "").toLowerCase()) {

//       case "grievance":
//         key = "griev";
//         prefix = "griev";
//         break;

//       case "appeal":
//         key = "appe";
//         prefix = "appe";
//         break;

//       case "complaint":
//         key = "compl";
//         prefix = "compl";
//         break;

//       default:
//         return next(new Error("Invalid request_type"));
//     }

//     let tracker = await SerialTracker.findOne({ key });

//     if (!tracker) {
//       tracker = await SerialTracker.create({
//         key,
//         last_serial: 9999
//       });
//     }

//     tracker.last_serial += 1;
//     await tracker.save();

//     this.regn_no = `${prefix}${tracker.last_serial}`;

//     next();

//   } catch (err) {
//     next(err);
//   }
// });

// module.exports = mongoose.model('AppGrievComp', AppGrievCompSchema);









//--------------

// // Auto-generate regn_no before saving
// // AppGrievCompSchema.pre('save', async function (next) {
// //   if (this.regn_no) return next();

// //   try {
// //     let tracker = await SerialTracker.findOne({ key: 'griev' });

// //     if (!tracker) {
// //       tracker = await SerialTracker.create({ key: 'griev', last_serial: 9999 });
// //     }

// //     tracker.last_serial += 1;
// //     await tracker.save();

// //     this.regn_no = `griev${tracker.last_serial}`;
// //     next();
// //   } catch (err) {
// //     next(err);
// //   }
// // });


