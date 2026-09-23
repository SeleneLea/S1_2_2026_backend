const { Course, Lesson, LessonContent, Comment } = require('../models');

const checkOwnership = (model) => {
    return async (req, res, next) => {
        try {
            const resource = await model.findOne({ where: { id: req.params.id, userId: req.user.id } });
            if (!resource) {
                return res.status(404).json({ error: true, message: 'Resource not found or not owned by you' });
            }
            next();
        } catch (error) {
            res.status(500).json({ error: true, message: 'Internal server error' });
        }
    };
};

module.exports = {
    checkCourseOwnership: checkOwnership(Course),
    checkLessonOwnership: checkOwnership(Lesson),
    checkLessonContentOwnership: checkOwnership(LessonContent),
    checkCommentOwnership: checkOwnership(Comment)
};
