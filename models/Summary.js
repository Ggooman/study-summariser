const { DataTypes } = require('sequelize');
const sequelize = require('../db');
const User = require('./User');

const Summary = sequelize.define('Summary', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  label: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'Untitled Summary'
  },
  filename: {
    type: DataTypes.STRING,
    allowNull: false
  },
  pages: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  wordCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  content: {
    type: DataTypes.TEXT('long'),
    allowNull: false
  }
}, {
  timestamps: true
});

User.hasMany(Summary, { foreignKey: 'userId' });
Summary.belongsTo(User, { foreignKey: 'userId' });

module.exports = Summary;