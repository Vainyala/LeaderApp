const AppGrievComp = require('../models/AppGrievComp');
const AuditLog = require('../models/auditLog');
const logger = require('../utils/logger');
const getDynamicQuery = require('../utils/getDynamicQuery');
const User = require('../models/User');
const notificationService = require('../services/notificationService');


/*
|--------------------------------------------------------------------------
| Allowed Status Values
|--------------------------------------------------------------------------
*/

const ALLOWED_STATUSES = [
  // 'Open',
  // 'In-Progress',
  // 'Pending',
  // 'Resolved',
  // 'Closed'
   'Open',
  'In Progress',
  'Rejected',
  'Resolved',
  'Cancelled'
];


/*
|--------------------------------------------------------------------------
| Helper: Get Admin Name
|--------------------------------------------------------------------------
|
| We don't trust updated_by coming from frontend.
| Backend gets the admin identity from authenticated user.
|
*/

const getAdminName = async (req) => {
  try {
    /*
    |--------------------------------------------------------------------------
    | First preference: information already available in JWT
    |--------------------------------------------------------------------------
    */

    const jwtUser =
      req.user || {};

    const jwtName =
      jwtUser.name ||
      jwtUser.user_name ||
      jwtUser.username ||
      jwtUser.full_name;

    if (jwtName) {
      return jwtName;
    }


    /*
    |--------------------------------------------------------------------------
    | Second preference: fetch admin from User collection
    |--------------------------------------------------------------------------
    */

    if (jwtUser.userId) {
      const adminUser = await User.findById(jwtUser.userId).lean();

      if (adminUser) {
        return (
          adminUser.name ||
          adminUser.user_name ||
          adminUser.username ||
          adminUser.full_name ||
          adminUser.email ||
          adminUser.user_email_id ||
          'Admin'
        );
      }
    }


    /*
    |--------------------------------------------------------------------------
    | Third fallback
    |--------------------------------------------------------------------------
    */

    return 'Admin';

  } catch (error) {
    console.warn(
      'Unable to determine admin name:',
      error.message
    );

    return 'Admin';
  }
};



/*
|--------------------------------------------------------------------------
| CREATE
|--------------------------------------------------------------------------
*/

exports.createAppGrievComp = async (req, res, next) => {
  try {

    const { user_type } = req;

    console.log(
      'createAppGrievComp -> User Type received from authenticate:',
      user_type
    );


    /*
    |--------------------------------------------------------------------------
    | Only normal users can create requests
    |--------------------------------------------------------------------------
    */

    if (user_type === 'admin') {

      console.log(
        'createAppGrievComp -> admin cannot create request'
      );

      return res.status(403).json({
        message: 'Oops! Login as Normal User to Raise a Request.'
      });
    }


    console.log(
      'Grievance Request Body:',
      req.body
    );


    /*
    |--------------------------------------------------------------------------
    | Never allow frontend to manually set regn_no
    |--------------------------------------------------------------------------
    */

    const {
      regn_no,
      status,
      updated_by,
      action_taken_comments,
      ...safeData
    } = req.body;


    /*
    |--------------------------------------------------------------------------
    | New request always starts as Open
    |--------------------------------------------------------------------------
    */

    const newEntry = new AppGrievComp({
      ...safeData,

      status: 'Open',

      action_taken_comments: '',

      updated_by: ''
    });


    /*
    |--------------------------------------------------------------------------
    | Save
    |--------------------------------------------------------------------------
    */

    await newEntry.save();


    /*
    |--------------------------------------------------------------------------
    | Notification
    |--------------------------------------------------------------------------
    */

    try {

      const user = await User.findOne({
        leader_regd_mobile_no:
          newEntry.leader_regd_mobile_no,
        user_email_id:
          newEntry.user_email_id
      });


      if (user?.fcm_token) {

        await notificationService.sendNotification({
          token: user.fcm_token,

          title: 'Request Submitted',

          body:
            `Your ${newEntry.request_type} ${newEntry.regn_no} has been submitted successfully.`,

          type: 'grievance'
        });
      }

    } catch (notifErr) {

      console.warn(
        'Notification failed (non-blocking):',
        notifErr.message
      );
    }


    /*
    |--------------------------------------------------------------------------
    | Audit Log
    |--------------------------------------------------------------------------
    */

    await AuditLog.create({
      user_id: req.user.userId,

      action: 'CREATE_GRIEVANCE',

      field: 'regn_no',

      leader_regd_mobile_no:
        newEntry.leader_regd_mobile_no,

      timestamp: new Date()
    });


    /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    */

    return res.status(201).json({

      message:
        `Congrats! Your ${newEntry.request_type} registered successfully`,

      regn_no: newEntry.regn_no,

      status: newEntry.status

    });

  } catch (err) {

    logger.error(
      `Grievance creation failed: ${err.message}`
    );

    res.status(500).json({
      error: 'Server error',
      details: err.message,
      requestId:
        req.headers['x-request-id'] || 'N/A'
    });
  }
};



/*
|--------------------------------------------------------------------------
| GET ALL
|--------------------------------------------------------------------------
*/

exports.getAllAppGrievComp = async (req, res, next) => {

  try {

    console.log(
      'getAllAppGrievCompController: Request Query Params:',
      req.query
    );


    const {
      leader_regd_mobile_no,
      user_email_id
    } = req.query;


    const { user_type } = req;


    console.log(
      'getAllAppGrievComp: User Type received from authenticate:',
      user_type
    );


    const query = getDynamicQuery(
      user_type,
      leader_regd_mobile_no,
      user_email_id
    );


    if (!query) {

      return res.status(403).json({
        message: 'Unauthorized user type'
      });
    }


    const entries = await AppGrievComp
      .find(query)
      .sort({
        createdAt: -1
      });


    return res.status(200).json(entries);

  } catch (err) {

    logger.error(
      `Fetching grievances failed: ${err.message}`
    );

    next(err);
  }
};



/*
|--------------------------------------------------------------------------
| SEARCH BY REGISTRATION NUMBER
|--------------------------------------------------------------------------
*/

exports.findAppGrievComp = async (req, res) => {

  console.log(
    'findAppGrievComp: Request Query:',
    req.query
  );


  const {
    leader_regd_mobile_no,
    user_email_id,
    regn_no
  } = req.query;


  try {

    const { user_type } = req;


    const query = getDynamicQuery(
      user_type,
      leader_regd_mobile_no,
      user_email_id
    );


    if (!query) {

      return res.status(403).json({
        message: 'Unauthorized user type'
      });
    }


    const finalQuery = {
      ...query,
      regn_no
    };


    console.log(
      'Final Query:',
      finalQuery
    );


    const data =
      await AppGrievComp.findOne(finalQuery);


    if (!data) {

      return res.status(404).json({
        error: 'AppGrievComp not found'
      });
    }


    /*
    |--------------------------------------------------------------------------
    | User will receive:
    |
    | status
    | action_taken_comments
    | updated_by
    |--------------------------------------------------------------------------
    */

    return res.json(data);

  } catch (err) {

    return res.status(500).json({
      error: 'Server error',
      details: err.message
    });
  }
};



/*
|--------------------------------------------------------------------------
| UPDATE
|--------------------------------------------------------------------------
|
| ONLY ADMIN CAN UPDATE:
|
| status
| action_taken_comments
|
| updated_by is automatically generated by backend.
|
*/

exports.updateAppGrievComp = async (req, res, next) => {

  try {

    const { user_type } = req;

    console.log(
      'updateAppGrievComp -> User Type:',
      user_type
    );


    /*
    |--------------------------------------------------------------------------
    | Only admin can update
    |--------------------------------------------------------------------------
    */

    if (user_type !== 'admin') {

      return res.status(403).json({
        message:
          'Oops! You are not authorized to update this request.'
      });

    }


    /*
    |--------------------------------------------------------------------------
    | Request body
    |--------------------------------------------------------------------------
    |
    | updated_by is intentionally taken from request body.
    |
    | Whoever handles the request can enter:
    |
    | Sanjay Jaiswal
    | PA to MP
    | Secretary
    | District Officer
    | etc.
    |
    */

    const {
      regn_no,
      status,
      action_taken_comments,
      updated_by
    } = req.body;


    console.log(
      'Update Request Body:',
      req.body
    );


    /*
    |--------------------------------------------------------------------------
    | Validate required fields
    |--------------------------------------------------------------------------
    */

    if (!regn_no) {

      return res.status(400).json({
        error: 'regn_no is required'
      });

    }


    if (!updated_by || !String(updated_by).trim()) {

      return res.status(400).json({
        error:
          'updated_by is required'
      });

    }


    /*
    |--------------------------------------------------------------------------
    | Validate status
    |--------------------------------------------------------------------------
    */

    if (
      status !== undefined &&
      !ALLOWED_STATUSES.includes(status)
    ) {

      return res.status(400).json({

        error:
          'Invalid status',

        allowed_statuses:
          ALLOWED_STATUSES

      });

    }


    /*
    |--------------------------------------------------------------------------
    | At least status OR comment must be supplied
    |--------------------------------------------------------------------------
    */

    if (
      status === undefined &&
      action_taken_comments === undefined
    ) {

      return res.status(400).json({

        error:
          'At least status or action_taken_comments is required'

      });

    }


    /*
    |--------------------------------------------------------------------------
    | Find existing grievance
    |--------------------------------------------------------------------------
    */

    const existing =
      await AppGrievComp.findOne({
        regn_no
      });


    console.log(
      'Existing AppGrievComp found:',
      existing
    );


    if (!existing) {

      return res.status(404).json({

        error:
          `AppGrievComp not found for registration number ${regn_no}`

      });

    }


    /*
    |--------------------------------------------------------------------------
    | Build update payload
    |--------------------------------------------------------------------------
    */

    const updatePayload = {};


    /*
    |--------------------------------------------------------------------------
    | Update status
    |--------------------------------------------------------------------------
    */

    if (status !== undefined) {

      updatePayload.status = status;

    }


    /*
    |--------------------------------------------------------------------------
    | Update comments
    |--------------------------------------------------------------------------
    */

    if (action_taken_comments !== undefined) {

      updatePayload.action_taken_comments =
        String(action_taken_comments).trim();

    }


    /*
    |--------------------------------------------------------------------------
    | Update manually entered person name
    |--------------------------------------------------------------------------
    */

    updatePayload.updated_by =
      String(updated_by).trim();


    /*
    |--------------------------------------------------------------------------
    | Update database
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    | findOneAndUpdate takes only:
    |
    | 1. filter
    | 2. update
    | 3. options
    |
    */

    const updated =
      await AppGrievComp.findOneAndUpdate(

        {
          regn_no
        },

        {
          $set: updatePayload
        },

        {
          new: true,
          runValidators: true
        }

      );


    /*
    |--------------------------------------------------------------------------
    | Safety check
    |--------------------------------------------------------------------------
    */

    if (!updated) {

      return res.status(404).json({

        error:
          'AppGrievComp not found'

      });

    }


    console.log(
      'Updated AppGrievComp:',
      updated
    );


    /*
    |--------------------------------------------------------------------------
    | Notification to user
    |--------------------------------------------------------------------------
    */

    try {

      const user =
  await User.findOne({

    leader_regd_mobile_no:
      updated.leader_regd_mobile_no,

    user_email_id:
      updated.user_email_id

  });


      if (user?.fcm_token) {

        let title =
          'Request Updated';

        let body =
          `Your ${updated.request_type} ${updated.regn_no} has been updated.`;


        /*
        |--------------------------------------------------------------------------
        | If status was updated
        |--------------------------------------------------------------------------
        */

        if (status !== undefined) {

          title =
            `${updated.request_type} Status Updated`;

          body =
            `Your ${updated.request_type} ${updated.regn_no} status is now ${updated.status}.`;

        }


        /*
        |--------------------------------------------------------------------------
        | If comment was updated
        |--------------------------------------------------------------------------
        */

        if (
          action_taken_comments !== undefined &&
          String(action_taken_comments).trim() !== ''
        ) {

          body +=
            ' Admin has added an action/comment.';

        }


        await notificationService.sendNotification({

          token:
            user.fcm_token,

          title,

          body,

          type:
            'grievance_update'

        });

      }

    } catch (notifErr) {

      console.warn(
        'Notification failed:',
        notifErr.message
      );

    }


    /*
    |--------------------------------------------------------------------------
    | Audit Log
    |--------------------------------------------------------------------------
    */

    await AuditLog.create({

      user_id:
        req.user.userId,

      action:
        'UPDATE_AppGrievComp',

      field:
        status !== undefined
          ? 'status'
          : 'action_taken_comments',

      leader_regd_mobile_no:
        updated.leader_regd_mobile_no,

      timestamp:
        new Date()

    });


    /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    */

    return res.status(200).json({

      message:
        `${updated.request_type} updated successfully`,

      data: {

        regn_no:
          updated.regn_no,

        request_type:
          updated.request_type,

        status:
          updated.status,

        action_taken_comments:
          updated.action_taken_comments,

        updated_by:
          updated.updated_by,

        updatedAt:
          updated.updatedAt

      }

    });

  } catch (err) {

    logger.error(
      `AppGrievComp update failed: ${err.message}`
    );

    next(err);

  }

};



/*
|--------------------------------------------------------------------------
| DELETE
|--------------------------------------------------------------------------
*/

exports.deleteAppGrievComp = async (req, res, next) => {

  try {

    const { user_type } = req;


    if (user_type !== 'admin') {

      return res.status(403).json({
        message:
          'Oops! You are not authorized to delete this request.'
      });
    }


    const {
      leader_regd_mobile_no,
      user_email_id,
      regn_no
    } = req.query;


    if (
      !leader_regd_mobile_no ||
      !user_email_id ||
      !regn_no
    ) {

      return res.status(400).json({
        error:
          'leader_regd_mobile_no, user_email_id and regn_no are required'
      });
    }


    const deleted =
      await AppGrievComp.findOneAndDelete({
        leader_regd_mobile_no,
        user_email_id,
        regn_no
      });


    if (!deleted) {

      return res.status(404).json({
        error:
          'AppGrievComp not found'
      });
    }


    await AuditLog.create({

      user_id:
        req.user.userId,

      action:
        'DELETE_AppGrievComp',

      field:
        'regn_no',

      leader_regd_mobile_no:
        deleted.leader_regd_mobile_no,

      timestamp:
        new Date()
    });


    return res.status(200).json({

      message:
        `${deleted.request_type} deleted successfully`,

      regn_no:
        deleted.regn_no

    });

  } catch (err) {

    logger.error(
      `AppGrievComp deletion failed: ${err.message}`
    );

    next(err);
  }
};



/*
|--------------------------------------------------------------------------
| COUNT BY REQUEST TYPE
|--------------------------------------------------------------------------
*/

exports.countAllAppGrievComp = async (
  req,
  res,
  next
) => {

  try {

    const {
      leader_regd_mobile_no,
      user_email_id,
      request_type
    } = req.query;


    if (
      !leader_regd_mobile_no ||
      !user_email_id ||
      !request_type
    ) {

      return res.status(400).json({
        error:
          'Missing required query parameters'
      });
    }


    const query =
      getDynamicQuery(
        req.user_type,
        leader_regd_mobile_no,
        user_email_id
      );


    if (!query) {

      return res.status(403).json({
        message:
          'Unauthorized user type'
      });
    }


    const finalQuery = {
      ...query,
      request_type
    };


    const count =
      await AppGrievComp.countDocuments(
        finalQuery
      );


    return res.status(200).json({

      message:
        `Request Type: ${request_type}`,

      count

    });

  } catch (err) {

    logger.error(
      `Fetching AppGrievComp count failed: ${err.message}`
    );

    next(err);
  }
};



/*
|--------------------------------------------------------------------------
| COUNT BY REQUEST TYPE + STATUS
|--------------------------------------------------------------------------
*/

exports.countAllAppGrievCompbyStatus = async (
  req,
  res,
  next
) => {

  try {

    const {
      leader_regd_mobile_no,
      user_email_id,
      request_type,
      status
    } = req.query;


    if (
      !leader_regd_mobile_no ||
      !user_email_id ||
      !request_type ||
      !status
    ) {

      return res.status(400).json({
        error:
          'Missing required query parameters'
      });
    }


    if (!ALLOWED_STATUSES.includes(status)) {

      return res.status(400).json({

        error:
          'Invalid status',

        allowed_statuses:
          ALLOWED_STATUSES
      });
    }


    const query =
      getDynamicQuery(
        req.user_type,
        leader_regd_mobile_no,
        user_email_id
      );


    if (!query) {

      return res.status(403).json({
        message:
          'Unauthorized user type'
      });
    }


    const finalQuery = {

      ...query,

      request_type,

      status

    };


    const count =
      await AppGrievComp.countDocuments(
        finalQuery
      );


    return res.status(200).json({

      message:
        `Request Type: ${request_type}, Status: ${status}`,

      count

    });

  } catch (err) {

    logger.error(
      `Fetching AppGrievComp failed: ${err.message}`
    );

    next(err);
  }
};



/*
|--------------------------------------------------------------------------
| GET BY REQUEST TYPE + OPTIONAL STATUS
|--------------------------------------------------------------------------
*/

exports.getAllAppGrievCompbyTypenStatus =
  async (req, res, next) => {

    try {

      const {
        leader_regd_mobile_no,
        user_email_id,
        request_type,
        status
      } = req.query;


      if (
        !leader_regd_mobile_no ||
        !user_email_id ||
        !request_type
      ) {

        return res.status(400).json({

          error:
            'leader_regd_mobile_no, user_email_id and request_type are required'

        });
      }


      const query =
        getDynamicQuery(
          req.user_type,
          leader_regd_mobile_no,
          user_email_id
        );


      if (!query) {

        return res.status(403).json({

          message:
            'Unauthorized user type'

        });
      }


      const finalQuery = {

        ...query,

        request_type

      };


      /*
      |--------------------------------------------------------------------------
      | Status is optional
      |--------------------------------------------------------------------------
      */

      if (
        status !== undefined &&
        status !== null &&
        String(status).trim() !== ''
      ) {

        if (
          !ALLOWED_STATUSES.includes(
            String(status).trim()
          )
        ) {

          return res.status(400).json({

            error:
              'Invalid status',

            allowed_statuses:
              ALLOWED_STATUSES

          });
        }


        finalQuery.status =
          String(status).trim();
      }


      const entries =
        await AppGrievComp
          .find(finalQuery)
          .sort({
            createdAt: -1
          });


      return res.status(200).json(entries);

    } catch (err) {

      logger.error(
        `Fetching AppGrievComp failed: ${err.message}`
      );

      next(err);
    }
  };








//***********

// const AppGrievComp = require('../models/AppGrievComp');
// const AuditLog = require('../models/auditLog');
// const logger = require('../utils/logger');
// const getDynamicQuery = require('../utils/getDynamicQuery');
// const User = require('../models/User');
// const notificationService = require('../services/notificationService');


// /*
// |--------------------------------------------------------------------------
// | Allowed Status Values
// |--------------------------------------------------------------------------
// */

// const ALLOWED_STATUSES = [
//   'Open',
//   'In-Progress',
//   'Pending',
//   'Resolved',
//   'Closed'
// ];


// /*
// |--------------------------------------------------------------------------
// | Helper: Get Admin Name
// |--------------------------------------------------------------------------
// |
// | We don't trust updated_by coming from frontend.
// | Backend gets the admin identity from authenticated user.
// |
// */

// const getAdminName = async (req) => {
//   try {
//     /*
//     |--------------------------------------------------------------------------
//     | First preference: information already available in JWT
//     |--------------------------------------------------------------------------
//     */

//     const jwtUser =
//       req.user || {};

//     const jwtName =
//       jwtUser.name ||
//       jwtUser.user_name ||
//       jwtUser.username ||
//       jwtUser.full_name;

//     if (jwtName) {
//       return jwtName;
//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Second preference: fetch admin from User collection
//     |--------------------------------------------------------------------------
//     */

//     if (jwtUser.userId) {
//       const adminUser = await User.findById(jwtUser.userId).lean();

//       if (adminUser) {
//         return (
//           adminUser.name ||
//           adminUser.user_name ||
//           adminUser.username ||
//           adminUser.full_name ||
//           adminUser.email ||
//           adminUser.user_email_id ||
//           'Admin'
//         );
//       }
//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Third fallback
//     |--------------------------------------------------------------------------
//     */

//     return 'Admin';

//   } catch (error) {
//     console.warn(
//       'Unable to determine admin name:',
//       error.message
//     );

//     return 'Admin';
//   }
// };



// /*
// |--------------------------------------------------------------------------
// | CREATE
// |--------------------------------------------------------------------------
// */

// exports.createAppGrievComp = async (req, res, next) => {
//   try {

//     const { user_type } = req;

//     console.log(
//       'createAppGrievComp -> User Type received from authenticate:',
//       user_type
//     );


//     /*
//     |--------------------------------------------------------------------------
//     | Only normal users can create requests
//     |--------------------------------------------------------------------------
//     */

//     if (user_type === 'admin') {

//       console.log(
//         'createAppGrievComp -> admin cannot create request'
//       );

//       return res.status(403).json({
//         message: 'Oops! Login as Normal User to Raise a Request.'
//       });
//     }


//     console.log(
//       'Grievance Request Body:',
//       req.body
//     );


//     /*
//     |--------------------------------------------------------------------------
//     | Never allow frontend to manually set regn_no
//     |--------------------------------------------------------------------------
//     */

//     const {
//       regn_no,
//       status,
//       updated_by,
//       action_taken_comments,
//       ...safeData
//     } = req.body;


//     /*
//     |--------------------------------------------------------------------------
//     | New request always starts as Open
//     |--------------------------------------------------------------------------
//     */

//     const newEntry = new AppGrievComp({
//       ...safeData,

//       status: 'Open',

//       action_taken_comments: '',

//       updated_by: ''
//     });


//     /*
//     |--------------------------------------------------------------------------
//     | Save
//     |--------------------------------------------------------------------------
//     */

//     await newEntry.save();


//     /*
//     |--------------------------------------------------------------------------
//     | Notification
//     |--------------------------------------------------------------------------
//     */

//     try {

//       const user = await User.findOne({
//         leader_regd_mobile_no:
//           newEntry.leader_regd_mobile_no
//       });


//       if (user?.fcm_token) {

//         await notificationService.sendNotification({
//           token: user.fcm_token,

//           title: 'Request Submitted',

//           body:
//             `Your ${newEntry.request_type} ${newEntry.regn_no} has been submitted successfully.`,

//           type: 'grievance'
//         });
//       }

//     } catch (notifErr) {

//       console.warn(
//         'Notification failed (non-blocking):',
//         notifErr.message
//       );
//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Audit Log
//     |--------------------------------------------------------------------------
//     */

//     await AuditLog.create({
//       user_id: req.user.userId,

//       action: 'CREATE_GRIEVANCE',

//       field: 'regn_no',

//       leader_regd_mobile_no:
//         newEntry.leader_regd_mobile_no,

//       timestamp: new Date()
//     });


//     /*
//     |--------------------------------------------------------------------------
//     | Response
//     |--------------------------------------------------------------------------
//     */

//     return res.status(201).json({

//       message:
//         `Congrats! Your ${newEntry.request_type} registered successfully`,

//       regn_no: newEntry.regn_no,

//       status: newEntry.status

//     });

//   } catch (err) {

//     logger.error(
//       `Grievance creation failed: ${err.message}`
//     );

//     res.status(500).json({
//       error: 'Server error',
//       details: err.message,
//       requestId:
//         req.headers['x-request-id'] || 'N/A'
//     });
//   }
// };



// /*
// |--------------------------------------------------------------------------
// | GET ALL
// |--------------------------------------------------------------------------
// */

// exports.getAllAppGrievComp = async (req, res, next) => {

//   try {

//     console.log(
//       'getAllAppGrievCompController: Request Query Params:',
//       req.query
//     );


//     const {
//       leader_regd_mobile_no,
//       user_email_id
//     } = req.query;


//     const { user_type } = req;


//     console.log(
//       'getAllAppGrievComp: User Type received from authenticate:',
//       user_type
//     );


//     const query = getDynamicQuery(
//       user_type,
//       leader_regd_mobile_no,
//       user_email_id
//     );


//     if (!query) {

//       return res.status(403).json({
//         message: 'Unauthorized user type'
//       });
//     }


//     const entries = await AppGrievComp
//       .find(query)
//       .sort({
//         createdAt: -1
//       });


//     return res.status(200).json(entries);

//   } catch (err) {

//     logger.error(
//       `Fetching grievances failed: ${err.message}`
//     );

//     next(err);
//   }
// };



// /*
// |--------------------------------------------------------------------------
// | SEARCH BY REGISTRATION NUMBER
// |--------------------------------------------------------------------------
// */

// exports.findAppGrievComp = async (req, res) => {

//   console.log(
//     'findAppGrievComp: Request Query:',
//     req.query
//   );


//   const {
//     leader_regd_mobile_no,
//     user_email_id,
//     regn_no
//   } = req.query;


//   try {

//     const { user_type } = req;


//     const query = getDynamicQuery(
//       user_type,
//       leader_regd_mobile_no,
//       user_email_id
//     );


//     if (!query) {

//       return res.status(403).json({
//         message: 'Unauthorized user type'
//       });
//     }


//     const finalQuery = {
//       ...query,
//       regn_no
//     };


//     console.log(
//       'Final Query:',
//       finalQuery
//     );


//     const data =
//       await AppGrievComp.findOne(finalQuery);


//     if (!data) {

//       return res.status(404).json({
//         error: 'AppGrievComp not found'
//       });
//     }


//     /*
//     |--------------------------------------------------------------------------
//     | User will receive:
//     |
//     | status
//     | action_taken_comments
//     | updated_by
//     |--------------------------------------------------------------------------
//     */

//     return res.json(data);

//   } catch (err) {

//     return res.status(500).json({
//       error: 'Server error',
//       details: err.message
//     });
//   }
// };



// /*
// |--------------------------------------------------------------------------
// | UPDATE
// |--------------------------------------------------------------------------
// |
// | ONLY ADMIN CAN UPDATE:
// |
// | status
// | action_taken_comments
// |
// | updated_by is automatically generated by backend.
// |
// */

// exports.updateAppGrievComp = async (req, res, next) => {

//   try {

//     const { user_type } = req;

//     console.log(
//       'updateAppGrievComp -> User Type:',
//       user_type
//     );


//     /*
//     |--------------------------------------------------------------------------
//     | Only admin can update
//     |--------------------------------------------------------------------------
//     */

//     if (user_type !== 'admin') {

//       return res.status(403).json({
//         message:
//           'Oops! You are not authorized to update this request.'
//       });

//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Request body
//     |--------------------------------------------------------------------------
//     |
//     | updated_by is intentionally taken from request body.
//     |
//     | Whoever handles the request can enter:
//     |
//     | Sanjay Jaiswal
//     | PA to MP
//     | Secretary
//     | District Officer
//     | etc.
//     |
//     */

//     const {
//       regn_no,
//       status,
//       action_taken_comments,
//       updated_by
//     } = req.body;


//     console.log(
//       'Update Request Body:',
//       req.body
//     );


//     /*
//     |--------------------------------------------------------------------------
//     | Validate required fields
//     |--------------------------------------------------------------------------
//     */

//     if (!regn_no) {

//       return res.status(400).json({
//         error: 'regn_no is required'
//       });

//     }


//     if (!updated_by || !String(updated_by).trim()) {

//       return res.status(400).json({
//         error:
//           'updated_by is required'
//       });

//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Validate status
//     |--------------------------------------------------------------------------
//     */

//     if (
//       status !== undefined &&
//       !ALLOWED_STATUSES.includes(status)
//     ) {

//       return res.status(400).json({

//         error:
//           'Invalid status',

//         allowed_statuses:
//           ALLOWED_STATUSES

//       });

//     }


//     /*
//     |--------------------------------------------------------------------------
//     | At least status OR comment must be supplied
//     |--------------------------------------------------------------------------
//     */

//     if (
//       status === undefined &&
//       action_taken_comments === undefined
//     ) {

//       return res.status(400).json({

//         error:
//           'At least status or action_taken_comments is required'

//       });

//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Find existing grievance
//     |--------------------------------------------------------------------------
//     */

//     const existing =
//       await AppGrievComp.findOne({
//         regn_no
//       });


//     console.log(
//       'Existing AppGrievComp found:',
//       existing
//     );


//     if (!existing) {

//       return res.status(404).json({

//         error:
//           `AppGrievComp not found for registration number ${regn_no}`

//       });

//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Build update payload
//     |--------------------------------------------------------------------------
//     */

//     const updatePayload = {};


//     /*
//     |--------------------------------------------------------------------------
//     | Update status
//     |--------------------------------------------------------------------------
//     */

//     if (status !== undefined) {

//       updatePayload.status = status;

//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Update comments
//     |--------------------------------------------------------------------------
//     */

//     if (action_taken_comments !== undefined) {

//       updatePayload.action_taken_comments =
//         String(action_taken_comments).trim();

//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Update manually entered person name
//     |--------------------------------------------------------------------------
//     */

//     updatePayload.updated_by =
//       String(updated_by).trim();


//     /*
//     |--------------------------------------------------------------------------
//     | Update database
//     |--------------------------------------------------------------------------
//     |
//     | IMPORTANT:
//     | findOneAndUpdate takes only:
//     |
//     | 1. filter
//     | 2. update
//     | 3. options
//     |
//     */

//     const updated =
//       await AppGrievComp.findOneAndUpdate(

//         {
//           regn_no
//         },

//         {
//           $set: updatePayload
//         },

//         {
//           new: true,
//           runValidators: true
//         }

//       );


//     /*
//     |--------------------------------------------------------------------------
//     | Safety check
//     |--------------------------------------------------------------------------
//     */

//     if (!updated) {

//       return res.status(404).json({

//         error:
//           'AppGrievComp not found'

//       });

//     }


//     console.log(
//       'Updated AppGrievComp:',
//       updated
//     );


//     /*
//     |--------------------------------------------------------------------------
//     | Notification to user
//     |--------------------------------------------------------------------------
//     */

//     try {

//       const user =
//   await User.findOne({

//     leader_regd_mobile_no:
//       updated.leader_regd_mobile_no,

//     user_email_id:
//       updated.user_email_id

//   });


//       if (user?.fcm_token) {

//         let title =
//           'Request Updated';

//         let body =
//           `Your ${updated.request_type} ${updated.regn_no} has been updated.`;


//         /*
//         |--------------------------------------------------------------------------
//         | If status was updated
//         |--------------------------------------------------------------------------
//         */

//         if (status !== undefined) {

//           title =
//             `${updated.request_type} Status Updated`;

//           body =
//             `Your ${updated.request_type} ${updated.regn_no} status is now ${updated.status}.`;

//         }


//         /*
//         |--------------------------------------------------------------------------
//         | If comment was updated
//         |--------------------------------------------------------------------------
//         */

//         if (
//           action_taken_comments !== undefined &&
//           String(action_taken_comments).trim() !== ''
//         ) {

//           body +=
//             ' Admin has added an action/comment.';

//         }


//         await notificationService.sendNotification({

//           token:
//             user.fcm_token,

//           title,

//           body,

//           type:
//             'grievance_update'

//         });

//       }

//     } catch (notifErr) {

//       console.warn(
//         'Notification failed:',
//         notifErr.message
//       );

//     }


//     /*
//     |--------------------------------------------------------------------------
//     | Audit Log
//     |--------------------------------------------------------------------------
//     */

//     await AuditLog.create({

//       user_id:
//         req.user.userId,

//       action:
//         'UPDATE_AppGrievComp',

//       field:
//         status !== undefined
//           ? 'status'
//           : 'action_taken_comments',

//       leader_regd_mobile_no:
//         updated.leader_regd_mobile_no,

//       timestamp:
//         new Date()

//     });


//     /*
//     |--------------------------------------------------------------------------
//     | Response
//     |--------------------------------------------------------------------------
//     */

//     return res.status(200).json({

//       message:
//         `${updated.request_type} updated successfully`,

//       data: {

//         regn_no:
//           updated.regn_no,

//         request_type:
//           updated.request_type,

//         status:
//           updated.status,

//         action_taken_comments:
//           updated.action_taken_comments,

//         updated_by:
//           updated.updated_by,

//         updatedAt:
//           updated.updatedAt

//       }

//     });

//   } catch (err) {

//     logger.error(
//       `AppGrievComp update failed: ${err.message}`
//     );

//     next(err);

//   }

// };



// /*
// |--------------------------------------------------------------------------
// | DELETE
// |--------------------------------------------------------------------------
// */

// exports.deleteAppGrievComp = async (req, res, next) => {

//   try {

//     const { user_type } = req;


//     if (user_type !== 'admin') {

//       return res.status(403).json({
//         message:
//           'Oops! You are not authorized to delete this request.'
//       });
//     }


//     const {
//       leader_regd_mobile_no,
//       user_email_id,
//       regn_no
//     } = req.query;


//     if (
//       !leader_regd_mobile_no ||
//       !user_email_id ||
//       !regn_no
//     ) {

//       return res.status(400).json({
//         error:
//           'leader_regd_mobile_no, user_email_id and regn_no are required'
//       });
//     }


//     const deleted =
//       await AppGrievComp.findOneAndDelete({
//         leader_regd_mobile_no,
//         user_email_id,
//         regn_no
//       });


//     if (!deleted) {

//       return res.status(404).json({
//         error:
//           'AppGrievComp not found'
//       });
//     }


//     await AuditLog.create({

//       user_id:
//         req.user.userId,

//       action:
//         'DELETE_AppGrievComp',

//       field:
//         'regn_no',

//       leader_regd_mobile_no:
//         deleted.leader_regd_mobile_no,

//       timestamp:
//         new Date()
//     });


//     return res.status(200).json({

//       message:
//         `${deleted.request_type} deleted successfully`,

//       regn_no:
//         deleted.regn_no

//     });

//   } catch (err) {

//     logger.error(
//       `AppGrievComp deletion failed: ${err.message}`
//     );

//     next(err);
//   }
// };



// /*
// |--------------------------------------------------------------------------
// | COUNT BY REQUEST TYPE
// |--------------------------------------------------------------------------
// */

// exports.countAllAppGrievComp = async (
//   req,
//   res,
//   next
// ) => {

//   try {

//     const {
//       leader_regd_mobile_no,
//       user_email_id,
//       request_type
//     } = req.query;


//     if (
//       !leader_regd_mobile_no ||
//       !user_email_id ||
//       !request_type
//     ) {

//       return res.status(400).json({
//         error:
//           'Missing required query parameters'
//       });
//     }


//     const query =
//       getDynamicQuery(
//         req.user_type,
//         leader_regd_mobile_no,
//         user_email_id
//       );


//     if (!query) {

//       return res.status(403).json({
//         message:
//           'Unauthorized user type'
//       });
//     }


//     const finalQuery = {
//       ...query,
//       request_type
//     };


//     const count =
//       await AppGrievComp.countDocuments(
//         finalQuery
//       );


//     return res.status(200).json({

//       message:
//         `Request Type: ${request_type}`,

//       count

//     });

//   } catch (err) {

//     logger.error(
//       `Fetching AppGrievComp count failed: ${err.message}`
//     );

//     next(err);
//   }
// };



// /*
// |--------------------------------------------------------------------------
// | COUNT BY REQUEST TYPE + STATUS
// |--------------------------------------------------------------------------
// */

// exports.countAllAppGrievCompbyStatus = async (
//   req,
//   res,
//   next
// ) => {

//   try {

//     const {
//       leader_regd_mobile_no,
//       user_email_id,
//       request_type,
//       status
//     } = req.query;


//     if (
//       !leader_regd_mobile_no ||
//       !user_email_id ||
//       !request_type ||
//       !status
//     ) {

//       return res.status(400).json({
//         error:
//           'Missing required query parameters'
//       });
//     }


//     if (!ALLOWED_STATUSES.includes(status)) {

//       return res.status(400).json({

//         error:
//           'Invalid status',

//         allowed_statuses:
//           ALLOWED_STATUSES
//       });
//     }


//     const query =
//       getDynamicQuery(
//         req.user_type,
//         leader_regd_mobile_no,
//         user_email_id
//       );


//     if (!query) {

//       return res.status(403).json({
//         message:
//           'Unauthorized user type'
//       });
//     }


//     const finalQuery = {

//       ...query,

//       request_type,

//       status

//     };


//     const count =
//       await AppGrievComp.countDocuments(
//         finalQuery
//       );


//     return res.status(200).json({

//       message:
//         `Request Type: ${request_type}, Status: ${status}`,

//       count

//     });

//   } catch (err) {

//     logger.error(
//       `Fetching AppGrievComp failed: ${err.message}`
//     );

//     next(err);
//   }
// };



// /*
// |--------------------------------------------------------------------------
// | GET BY REQUEST TYPE + OPTIONAL STATUS
// |--------------------------------------------------------------------------
// */

// exports.getAllAppGrievCompbyTypenStatus =
//   async (req, res, next) => {

//     try {

//       const {
//         leader_regd_mobile_no,
//         user_email_id,
//         request_type,
//         status
//       } = req.query;


//       if (
//         !leader_regd_mobile_no ||
//         !user_email_id ||
//         !request_type
//       ) {

//         return res.status(400).json({

//           error:
//             'leader_regd_mobile_no, user_email_id and request_type are required'

//         });
//       }


//       const query =
//         getDynamicQuery(
//           req.user_type,
//           leader_regd_mobile_no,
//           user_email_id
//         );


//       if (!query) {

//         return res.status(403).json({

//           message:
//             'Unauthorized user type'

//         });
//       }


//       const finalQuery = {

//         ...query,

//         request_type

//       };


//       /*
//       |--------------------------------------------------------------------------
//       | Status is optional
//       |--------------------------------------------------------------------------
//       */

//       if (
//         status !== undefined &&
//         status !== null &&
//         String(status).trim() !== ''
//       ) {

//         if (
//           !ALLOWED_STATUSES.includes(
//             String(status).trim()
//           )
//         ) {

//           return res.status(400).json({

//             error:
//               'Invalid status',

//             allowed_statuses:
//               ALLOWED_STATUSES

//           });
//         }


//         finalQuery.status =
//           String(status).trim();
//       }


//       const entries =
//         await AppGrievComp
//           .find(finalQuery)
//           .sort({
//             createdAt: -1
//           });


//       return res.status(200).json(entries);

//     } catch (err) {

//       logger.error(
//         `Fetching AppGrievComp failed: ${err.message}`
//       );

//       next(err);
//     }
//   };












//21-08-2026 commented

// const AppGrievComp = require('../models/AppGrievComp');
// const AuditLog = require('../models/auditLog');
// const logger = require('../utils/logger');
// const getDynamicQuery = require('../utils/getDynamicQuery');
// const User = require('../models/User');
// const notificationService = require('../services/notificationService');


// exports.createAppGrievComp = async (req, res, next) => {
//   try {

//     const { user_type } = req;

//     console.log('createAppGrievComp-> User Type received from authenticate:', user_type);

//     if (user_type === 'admin') {
//       console.log('createAppointment -> user_type: admin: Request cant be created');
//       return res.status(201).json('Oops! Login as Normal User to Raise a Request.');
//     }

//     console.log('Grievance Request Body:', req.body);
//     let result = '';

//     const { regn_no, ...safeData } = req.body;

//     const newEntry = new AppGrievComp(safeData);
//     await newEntry.save(); // triggers regn_no generation

//     try {
//       const user = await User.findOne({
//         leader_regd_mobile_no: newEntry.leader_regd_mobile_no
//       });

//       if (user?.fcm_token) {
//         await notificationService.sendNotification({
//           token: user.fcm_token,
//           title: "Grievance Submitted",
//           body: `Your grievance ${newEntry.regn_no} has been submitted successfully.`,
//           type: "grievance"
//         });
//       }
//     } catch (notifErr) {
//       console.warn(
//         "Notification failed (non-blocking):",
//         notifErr.message
//       );
//     }

//     await AuditLog.create({
//       user_id: req.user.userId,
//       action: 'CREATE_GRIEVANCE',
//       field: 'regn_no',
//       leader_regd_mobile_no: newEntry.leader_regd_mobile_no,
//       timestamp: new Date()
//     });


//     //    result = 'Congrates! Your '+req.body.request_type+' registered successfully Vide Regn# '+newEntry.regn_no;
//     result = {
//       message: 'Congrats! Your ' + req.body.request_type + ' registered successfully',
//       regn_no: newEntry.regn_no
//     };
//     res.status(201).json(result);
//   } catch (err) {
//     logger.error(`Grievance creation failed: ${err.message}`);
//     res.status(500).json({
//       error: 'Server error',
//       details: err.message,
//       requestId: req.headers['x-request-id'] || 'N/A'
//     });
//   }
// };

// exports.getAllAppGrievComp = async (req, res, next) => {
//   try {
//     console.log('getAllAppGrievCompController: Request Query Params:', req.body);

//     const { leader_regd_mobile_no, user_email_id } = req.query;
//     console.log('getAllAppGrievCompController: Query Filter:', { leader_regd_mobile_no, user_email_id });

//     const { user_type } = req;

//     console.log('getAllAppGrievComp: User Type received from authenticate:', user_type);

//     const query = getDynamicQuery(user_type, leader_regd_mobile_no, user_email_id);

//     if (!query) {
//       return res.status(403).json({ message: 'Unauthorized user type' });
//     } else {
//       console.log('getAllAppointments: Dynamic Query: ', query);
//     }

//     const entries = await AppGrievComp.find(query).sort({ createdAt: -1 });
//     const no_docs = entries.length;

//     console.log('Total # Documents found: ', no_docs);

//     res.status(200).json(entries);
//   } catch (err) {
//     logger.error(`Fetching grievances failed: ${err.message}`);
//     next(err);
//   }
// };


// // Routes: appi/appointments/search
// exports.findAppGrievComp = async (req, res) => {
//   console.log("findAppGrievComp:  Request Query: ", req.query);
//   const { leader_regd_mobile_no, user_email_id, regn_no } = req.query;

//   try {
//     const { user_type } = req;

//     console.log('User Type received from authenticate:', user_type);

//     const query = getDynamicQuery(user_type, leader_regd_mobile_no, user_email_id);

//     if (!query) {
//       return res.status(403).json({ message: 'Unauthorized user type' });
//     } else {
//       console.log('findAppointment->Dynamic Query received:', query);
//     }

//     const finalQuery = { ...query, regn_no };
//     console.log(' Final Query:', finalQuery);

//     const data = await AppGrievComp.findOne(finalQuery);

//     if (!data) {
//       return res.status(404).json({ error: 'AppGrievComp not found' });
//     }

//     res.json(data);
//   } catch (err) {
//     res.status(500).json({ error: 'Server error' });
//   }
// };


// // Update an AppGrievComp for a given leader_regd_mobile_no, user_email_id and regn_no
// exports.updateAppGrievComp = async (req, res, next) => {
//   try {
//     const { user_type } = req;

//     console.log('updateAppGrievComp -> User Type received from authenticate:', user_type);

//     if (user_type === 'user') {
//       console.log('updateAppGrievComp -> user_type: user: Edit action forbidden.');
//       return res.status(201).json('Oops! Ypu are not authorized to Edit Request.');
//     }

//     let result = '';

//     const { leader_regd_mobile_no, user_email_id, regn_no, ...updatePayload } = req.body;

//     if (!leader_regd_mobile_no || !user_email_id || !regn_no) {
//       return res.status(400).json({ error: 'Missing required body parameters' });
//     }

//     console.log('Update Filter:', { leader_regd_mobile_no, regn_no });
//     console.log('Update Payload:', updatePayload);

//     const updated = await AppGrievComp.findOneAndUpdate(
//       { leader_regd_mobile_no, regn_no },
//       { $set: updatePayload },
//       { new: true }
//     );

//     try {

//       const user = await User.findOne({
//         leader_regd_mobile_no: updated.leader_regd_mobile_no
//       });

//       if (user?.fcm_token) {

//         let title = "Grievance Updated";
//         let body = `Your grievance ${updated.regn_no} has been updated`;

//         if (updated.status === "APPROVED") {
//           title = "Grievance Approved";
//           body = `Your grievance ${updated.regn_no} has been approved`;
//         }

//         if (updated.status === "REJECTED") {
//           title = "Grievance Rejected";
//           body = `Your grievance ${updated.regn_no} has been rejected`;
//         }

//         if (req.body.admin_comments) {
//           title = "New Comment Added";
//           body = `Admin added a comment on grievance ${updated.regn_no}`;
//         }

//         await notificationService.sendNotification({
//           token: user.fcm_token,
//           title,
//           body,
//           type: "grievance_update"
//         });
//       }

//     } catch (notifErr) {
//       console.warn(
//         "Notification failed:",
//         notifErr.message
//       );
//     }

//     if (!updated) {
//       return res.status(404).json({ error: 'AppGrievComp not found with given identifiers' });
//     }

//     await AuditLog.create({
//       user_id: req.user.userId,
//       action: 'UPDATE_AppGrievComp',
//       field: 'regn_no',
//       leader_regd_mobile_no: updated.leader_regd_mobile_no,
//       timestamp: new Date()
//     });

//     //result = 'Congrates! '+updated.request_type+' details updated successfully Vide Regn# '+updated.regn_no;
//     result = {
//       message: 'Congrates! ' + updated.request_type + ' details updated successfully',
//       regn_no: updated.regn_no
//     };
//     res.status(201).json(result);
//     //res.status(200).json(updated);
//   } catch (err) {
//     logger.error(`AppGrievComp update failed: ${err.message}`);
//     next(err);
//   }
// };


// // Delete an AppGrievComp using leader_regd_mobile_no, user_email_id, and regn_no
// exports.deleteAppGrievComp = async (req, res, next) => {
//   try {

//     const { user_type } = req;

//     console.log('deleteAppGrievComp->User Type received from authenticate:', user_type);

//     if (user_type === 'user') {
//       console.log('deleteAppGrievComp -> user_type: user: Edit action forbidden.');
//       return res.status(201).json('Oops! Ypu are not authorized to Delete Request.');
//     }

//     const { leader_regd_mobile_no, user_email_id, regn_no } = req.query;

//     if (!leader_regd_mobile_no || !user_email_id || !regn_no) {
//       return res.status(400).json({ error: 'Missing required query parameters' });
//     }

//     console.log('Delete Filter:', { leader_regd_mobile_no, user_email_id, regn_no });

//     const deleted = await AppGrievComp.findOneAndDelete({
//       leader_regd_mobile_no,
//       regn_no
//     });

//     if (!deleted) {
//       return res.status(404).json({ error: 'AppGrievComp not found with given identifiers' });
//     }

//     await AuditLog.create({
//       user_id: req.user.userId,
//       action: 'DELETE_AppGrievComp',
//       field: 'regn_no',
//       leader_regd_mobile_no: deleted.leader_regd_mobile_no,
//       timestamp: new Date()
//     });

//     res.status(200).json({
//       message: deleted.request_type + ' deleted successfully',
//       regn_no: deleted.regn_no
//     });
//   } catch (err) {
//     logger.error(`AppGrievComp deletion failed: ${err.message}`);
//     next(err);
//   }
// };


// // Get count of all request_type=appeal/grievances/complaints - for Dashboard
// exports.countAllAppGrievComp = async (req, res, next) => {
//   try {

//     const { user_type } = req;

//     const { leader_regd_mobile_no, user_email_id, request_type } = req.query;
//     console.log('Request Query Params:', req.query);

//     if (!leader_regd_mobile_no || !user_email_id || !request_type) {
//       return res.status(400).json({ error: 'Missing required query parameters' });
//     }
//     console.log('Query Filter:', { leader_regd_mobile_no, user_email_id, request_type });

//     const query = getDynamicQuery(user_type, leader_regd_mobile_no, user_email_id);
//     if (!query) {
//       return res.status(403).json({ message: 'Unauthorized user type' });
//     } else {
//       console.log('countAllAppGrievComp->dynamic query: ', query);
//     }

//     const finalQuery = { ...query, request_type };
//     console.log(' Final Query:', finalQuery);

//     const entries = await AppGrievComp.find({
//       finalQuery
//     }).sort({ createdAt: -1 });

//     tot_no_docs = entries.length;
//     console.log('Total # ', request_type, 'found: ', tot_no_docs);

//     res.status(200).json({
//       message: 'Request Type:' + request_type,
//       count: tot_no_docs
//     });
//   } catch (err) {
//     logger.error(`Fetching Appointments failed: ${err.message}`);
//     next(err);
//   }
// };


// // Get count of all appGrievComp by request_type and status - for Dashboard
// exports.countAllAppGrievCompbyStatus = async (req, res, next) => {
//   try {
//     const { user_type } = req;
//     const { leader_regd_mobile_no, user_email_id, request_type, status } = req.query;

//     console.log('Request Query Params:', req.query);

//     if (!leader_regd_mobile_no || !user_email_id || !request_type || !status) {
//       return res.status(400).json({ error: 'Missing required body parameters' });
//     }

//     const query = getDynamicQuery(user_type, leader_regd_mobile_no, user_email_id);
//     if (!query) {
//       return res.status(403).json({ message: 'Unauthorized user type' });
//     }

//     const finalQuery = { ...query, request_type, status };
//     console.log('Final Query:', finalQuery);

//     const entries = await AppGrievComp.find(finalQuery);
//     const count = entries.length;

//     console.log('Total AppGrievComp found:', count);

//     res.status(200).json({
//       message: `Request Type: ${request_type}, Status: ${status}`,
//       count: count
//     });
//   } catch (err) {
//     logger.error(`Fetching AppGrievComp failed: ${err.stack}`);
//     next(err);
//   }
// };

// // Get all appeal/grievance/complaints data  by given request_type and status
// exports.getAllAppGrievCompbyTypenStatus = async (req, res, next) => {
//   try {
//     const { user_type } = req;

//     const {
//       leader_regd_mobile_no,
//       user_email_id,
//       request_type,
//       status
//     } = req.query;

//     console.log('Request Query Params:', req.query);

//     // ---------------------------------------------------------
//     // Required parameters
//     // ---------------------------------------------------------

//     if (
//       !leader_regd_mobile_no ||
//       !user_email_id ||
//       !request_type
//     ) {
//       return res.status(400).json({
//         error:
//           'leader_regd_mobile_no, user_email_id and request_type are required'
//       });
//     }

//     console.log('Query Filter:', {
//       leader_regd_mobile_no,
//       user_email_id,
//       request_type,
//       status
//     });

//     // ---------------------------------------------------------
//     // Dynamic user query
//     // ---------------------------------------------------------

//     const query = getDynamicQuery(
//       user_type,
//       leader_regd_mobile_no,
//       user_email_id
//     );

//     if (!query) {
//       return res.status(403).json({
//         message: 'Unauthorized user type'
//       });
//     }

//     // ---------------------------------------------------------
//     // Build final query
//     // ---------------------------------------------------------

//     const finalQuery = {
//       ...query,
//       request_type
//     };

//     // IMPORTANT:
//     // Only add status when it is actually provided.
//     //
//     // If status is NOT provided:
//     //     Appeal     -> all Appeal records
//     //     Grievance  -> all Grievance records
//     //     Complaints -> all Complaints records
//     //
//     // If status is provided:
//     //     Appeal + Open -> only Open Appeals
//     //     Appeal + Resolved -> only Resolved Appeals
//     // etc.

//     if (
//       status !== undefined &&
//       status !== null &&
//       String(status).trim() !== ''
//     ) {
//       finalQuery.status = String(status).trim();
//     }

//     console.log('📄 Final Query:', finalQuery);

//     // ---------------------------------------------------------
//     // Fetch records
//     // ---------------------------------------------------------

//     const entries = await AppGrievComp
//       .find(finalQuery)
//       .sort({ createdAt: -1 });

//     const no_docs = entries.length;

//     console.log(
//       'Total # Documents found:',
//       no_docs
//     );

//     return res.status(200).json(entries);

//   } catch (err) {

//     logger.error(
//       `Fetching Appointments failed: ${err.message}`
//     );

//     next(err);
//   }
// };